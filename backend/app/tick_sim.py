"""Replay TV trade times on on-disk bid/ask ticks (analytics-style bar-close fill)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app import duckdb_client as db
from app.config import Settings, get_settings
from app.ticks_service import load_manifest
from app.trades_service import NormalizedTrade, load_trades

CONTRACT_SIZE_FX = 100_000
CONTRACT_SIZE_METAL = 100


@dataclass
class TradeFill:
    trade_id: int
    side: str  # long | short
    signal_entry: str | None
    signal_exit: str | None
    tv_entry_time: str | None
    tv_exit_time: str | None
    tv_entry_price: float | None
    tv_exit_price: float | None
    tv_pnl_usd: float | None
    tv_qty: float
    fill_entry_time: str | None
    fill_exit_time: str | None
    fill_entry_price: float | None
    fill_exit_price: float | None
    entry_side: str | None
    exit_side: str | None
    entry_delay_sec: float | None
    exit_delay_sec: float | None
    status: str  # ok | no_ticks | partial | open
    # Peak favorable / worst adverse floating PnL while trade is open (USD)
    max_runup_usd: float | None = None
    max_drawdown_usd: float | None = None
    entry_fill_ms: int | None = None
    exit_fill_ms: int | None = None


def _contract_size(symbol: str) -> int:
    u = symbol.upper()
    if u.startswith("XAU") or u.startswith("XAG"):
        return CONTRACT_SIZE_METAL
    return CONTRACT_SIZE_FX


def _pip_size(symbol: str, settings: Settings) -> float:
    digits = 5
    info = load_manifest(settings).get("symbols", {}).get(symbol, {})
    if isinstance(info, dict) and info.get("digits") is not None:
        try:
            digits = int(info["digits"])
        except (TypeError, ValueError):
            digits = 5
    # JPY 3 digits → 0.01 pip; 5-digit FX → 0.0001
    return 10 ** -(max(digits, 1) - 1)


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _fmt_ms(ms: int, settings: Settings | None = None) -> str:
    """Format fill/chart times in the same TZ as TV trades (TV_TRADES_TZ)."""
    settings = settings or get_settings()
    tz = ZoneInfo(settings.tv_trades_tz)
    return datetime.fromtimestamp(ms / 1000.0, tz=tz).isoformat(timespec="milliseconds")


def _pnl_usd(
    symbol: str,
    direction: str,
    entry: float,
    exit_: float,
    lots: float,
) -> float:
    units = lots * _contract_size(symbol)
    if direction == "long":
        raw = (exit_ - entry) * units
    else:
        raw = (entry - exit_) * units
    if symbol.upper().endswith("JPY"):
        return raw / exit_ if exit_ else 0.0
    return raw


def _needed_side(direction: str, kind: str) -> str:
    # long: buy ask / sell bid; short: sell bid / buy ask
    if kind == "entry":
        return "ASK" if direction == "long" else "BID"
    return "BID" if direction == "long" else "ASK"


def _mark_side(direction: str) -> str:
    """Quote side used to mark floating PnL while the trade is open."""
    return "BID" if direction == "long" else "ASK"


def _resolve_fills_streaming(
    symbol: str,
    events: list[tuple[int, str, int, str]],
    settings: Settings,
) -> dict[tuple[int, str], tuple[int, float]]:
    """
    events: (trade_index, kind, fill_ms, need_side)
    Returns map (trade_index, kind) -> (timestamp_ms, price).

    Uses DuckDB ASOF JOIN with negated timestamps so each event gets the
    first tick at/after fill_ms on the required side (forward fill).
    """
    if not events:
        return {}
    sym_dir = settings.ticks_dir / symbol
    if not list(sym_dir.glob("*.parquet")):
        return {}

    # Safe: idx/ms are ints; kind/side are controlled enums
    values_sql = ", ".join(
        f"({int(idx)}, '{kind}', {int(fill_ms)}::BIGINT, '{need}')"
        for idx, kind, fill_ms, need in events
        if kind in {"entry", "exit"} and need in {"BID", "ASK"}
    )
    if not values_sql:
        return {}

    # Only read day files that cover the fill window (+1 day slack)
    day_files: list[str] = []
    seen_days: set[str] = set()
    for _, _, fill_ms, _ in events:
        for offset in (0, 1):
            day = (
                datetime.fromtimestamp(fill_ms / 1000.0, tz=timezone.utc)
                + timedelta(days=offset)
            ).strftime("%Y-%m-%d")
            if day in seen_days:
                continue
            path = sym_dir / f"{day}.parquet"
            if path.exists():
                seen_days.add(day)
                day_files.append(str(path.resolve()).replace("\\", "/"))
    if not day_files:
        return {}

    files_sql = ", ".join(f"'{p}'" for p in day_files)
    min_ms = min(e[2] for e in events)
    max_ms = max(e[2] for e in events) + 86_400_000  # +1 day
    sql = f"""
        WITH events AS (
          SELECT * FROM (VALUES {values_sql})
            AS t(idx, kind, fill_ms, need_side)
        ),
        ticks AS (
          SELECT timestamp_ms::BIGINT AS timestamp_ms,
                 price::DOUBLE AS price,
                 upper(side::VARCHAR) AS side
          FROM read_parquet([{files_sql}])
          WHERE timestamp_ms >= {int(min_ms)} AND timestamp_ms <= {int(max_ms)}
        )
        SELECT e.idx, e.kind, t.timestamp_ms AS hit_ms, t.price AS hit_price
        FROM events e
        ASOF LEFT JOIN ticks t
          ON t.side = e.need_side AND (-t.timestamp_ms) <= (-e.fill_ms)
    """
    rows = db.query(sql)
    hits: dict[tuple[int, str], tuple[int, float]] = {}
    for row in rows:
        if row["hit_ms"] is None or row["hit_price"] is None:
            continue
        hits[(int(row["idx"]), str(row["kind"]))] = (
            int(row["hit_ms"]),
            float(row["hit_price"]),
        )
    return hits


def simulate_fills(
    symbol: str,
    strategy_id: str,
    *,
    chart_tf_minutes: int = 10,
    from_ts: str | None = None,
    to_ts: str | None = None,
    settings: Settings | None = None,
) -> list[TradeFill]:
    """Fill at bar close: TV list time is bar open; alert/fill at open + TF."""
    settings = settings or get_settings()
    trades = load_trades(symbol, strategy_id, settings=settings)

    def in_range(t: NormalizedTrade) -> bool:
        if from_ts and t.open_time and t.open_time < from_ts:
            return False
        if to_ts and t.open_time and t.open_time > to_ts:
            return False
        return True

    trades = [t for t in trades if in_range(t)]
    # 0 = fill at TV time as-is (no bar-close offset)
    tf = timedelta(minutes=max(0, chart_tf_minutes))

    # Precompute fill clocks + events for closed trades with valid times
    prepared: list[dict[str, Any]] = []
    events: list[tuple[int, str, int, str]] = []
    for t in trades:
        base: dict[str, Any] = {
            "trade": t,
            "entry_fill_dt": None,
            "exit_fill_dt": None,
            "entry_need": None,
            "exit_need": None,
            "skip_status": None,
        }
        if t.is_open or t.close_time is None or t.open_time is None:
            base["skip_status"] = "open"
            prepared.append(base)
            continue
        entry_dt = _parse_iso(t.open_time)
        exit_dt = _parse_iso(t.close_time)
        if entry_dt is None or exit_dt is None:
            base["skip_status"] = "no_ticks"
            prepared.append(base)
            continue
        entry_fill_dt = entry_dt + tf
        exit_fill_dt = exit_dt + tf
        entry_need = _needed_side(t.side, "entry")
        exit_need = _needed_side(t.side, "exit")
        idx = len(prepared)
        base.update(
            {
                "entry_fill_dt": entry_fill_dt,
                "exit_fill_dt": exit_fill_dt,
                "entry_need": entry_need,
                "exit_need": exit_need,
            }
        )
        prepared.append(base)
        events.append((idx, "entry", _to_ms(entry_fill_dt), entry_need))
        events.append((idx, "exit", _to_ms(exit_fill_dt), exit_need))

    hits = _resolve_fills_streaming(symbol, events, settings)

    fills: list[TradeFill] = []
    for idx, item in enumerate(prepared):
        t: NormalizedTrade = item["trade"]
        if item["skip_status"]:
            fills.append(
                TradeFill(
                    trade_id=t.trade_id,
                    side=t.side,
                    signal_entry=t.signal_entry,
                    signal_exit=t.signal_exit,
                    tv_entry_time=t.open_time,
                    tv_exit_time=t.close_time,
                    tv_entry_price=t.open_price,
                    tv_exit_price=t.close_price,
                    tv_pnl_usd=t.tv_net_pnl,
                    tv_qty=t.size,
                    fill_entry_time=None,
                    fill_exit_time=None,
                    fill_entry_price=None,
                    fill_exit_price=None,
                    entry_side=None,
                    exit_side=None,
                    entry_delay_sec=None,
                    exit_delay_sec=None,
                    status=item["skip_status"],
                )
            )
            continue

        ef = hits.get((idx, "entry"))
        xf = hits.get((idx, "exit"))
        entry_fill_dt: datetime = item["entry_fill_dt"]
        exit_fill_dt: datetime = item["exit_fill_dt"]
        entry_need: str = item["entry_need"]
        exit_need: str = item["exit_need"]

        if ef and xf:
            status = "ok"
        elif ef or xf:
            status = "partial"
        else:
            status = "no_ticks"

        fills.append(
            TradeFill(
                trade_id=t.trade_id,
                side=t.side,
                signal_entry=t.signal_entry,
                signal_exit=t.signal_exit,
                tv_entry_time=t.open_time,
                tv_exit_time=t.close_time,
                tv_entry_price=t.open_price,
                tv_exit_price=t.close_price,
                tv_pnl_usd=t.tv_net_pnl,
                tv_qty=t.size,
                fill_entry_time=_fmt_ms(ef[0], settings) if ef else None,
                fill_exit_time=_fmt_ms(xf[0], settings) if xf else None,
                fill_entry_price=ef[1] if ef else None,
                fill_exit_price=xf[1] if xf else None,
                entry_side=entry_need.lower() if ef else None,
                exit_side=exit_need.lower() if xf else None,
                entry_delay_sec=(ef[0] / 1000.0 - entry_fill_dt.timestamp())
                if ef
                else None,
                exit_delay_sec=(xf[0] / 1000.0 - exit_fill_dt.timestamp())
                if xf
                else None,
                status=status,
                entry_fill_ms=ef[0] if ef else None,
                exit_fill_ms=xf[0] if xf else None,
            )
        )

    return fills


def _day_files_for_range(
    symbol: str, min_ms: int, max_ms: int, settings: Settings
) -> list[str]:
    sym_dir = settings.ticks_dir / symbol
    if not sym_dir.exists():
        return []
    files: list[str] = []
    seen: set[str] = set()
    start = datetime.fromtimestamp(min_ms / 1000.0, tz=timezone.utc).date()
    end = datetime.fromtimestamp(max_ms / 1000.0, tz=timezone.utc).date()
    day = start
    while day <= end:
        key = day.strftime("%Y-%m-%d")
        path = sym_dir / f"{key}.parquet"
        if key not in seen and path.exists():
            seen.add(key)
            files.append(str(path.resolve()).replace("\\", "/"))
        day = day + timedelta(days=1)
    return files


def compute_excursions(
    symbol: str,
    fills: list[TradeFill],
    *,
    lots: float,
    path_points: int = 64,
    settings: Settings | None = None,
) -> tuple[dict[int, dict[str, float]], dict[int, list[dict[str, Any]]]]:
    """
    Per-trade max run-up / max drawdown (floating USD PnL) and a
    time-bucketed mark-to-market path (real floating PnL, not a 4-point sketch).

    One DuckDB scan: join ticks→spans, then agg + buckets from the same match.
    """
    settings = settings or get_settings()
    bucket_count = max(16, min(path_points, 96))
    spans: list[tuple[int, int, int, float, str, str]] = []
    for f in fills:
        if (
            f.status != "ok"
            or f.fill_entry_price is None
            or f.entry_fill_ms is None
            or f.exit_fill_ms is None
            or f.exit_fill_ms < f.entry_fill_ms
            or f.side not in {"long", "short"}
        ):
            continue
        spans.append(
            (
                f.trade_id,
                int(f.entry_fill_ms),
                int(f.exit_fill_ms),
                float(f.fill_entry_price),
                f.side,
                _mark_side(f.side),
            )
        )
    if not spans:
        return {}, {}

    min_ms = min(s[1] for s in spans)
    max_ms = max(s[2] for s in spans)
    day_files = _day_files_for_range(symbol, min_ms, max_ms, settings)
    if not day_files:
        return {}, {}

    values_sql = ", ".join(
        f"({tid}, {entry_ms}::BIGINT, {exit_ms}::BIGINT, {entry_px}::DOUBLE, '{direction}', '{mark}')"
        for tid, entry_ms, exit_ms, entry_px, direction, mark in spans
    )
    files_sql = ", ".join(f"'{p}'" for p in day_files)
    sql = f"""
        WITH spans AS (
          SELECT * FROM (VALUES {values_sql})
            AS t(trade_id, entry_ms, exit_ms, entry_px, direction, mark_side)
        ),
        ticks AS (
          SELECT timestamp_ms::BIGINT AS timestamp_ms,
                 price::DOUBLE AS price,
                 upper(side::VARCHAR) AS side
          FROM read_parquet([{files_sql}])
          WHERE timestamp_ms >= {int(min_ms)} AND timestamp_ms <= {int(max_ms)}
        ),
        matched AS (
          SELECT s.trade_id, s.entry_ms, s.exit_ms, s.entry_px, s.direction,
                 t.timestamp_ms, t.price
          FROM spans s
          JOIN ticks t
            ON t.side = s.mark_side
           AND t.timestamp_ms >= s.entry_ms
           AND t.timestamp_ms <= s.exit_ms
        ),
        agg AS (
          SELECT trade_id, entry_ms, exit_ms, entry_px, direction,
                 min(price) AS min_px,
                 max(price) AS max_px
          FROM matched
          GROUP BY trade_id, entry_ms, exit_ms, entry_px, direction
        ),
        buckets AS (
          SELECT trade_id, entry_px, direction,
                 least(
                   {bucket_count - 1},
                   greatest(
                     0,
                     CAST(floor(
                       (timestamp_ms - entry_ms) * {bucket_count}
                       / greatest(exit_ms - entry_ms, 1)
                     ) AS INTEGER)
                   )
                 ) AS bucket,
                 max(timestamp_ms) AS ts_ms,
                 arg_max(price, timestamp_ms) AS price
          FROM matched
          GROUP BY trade_id, entry_px, direction, 4
        )
        SELECT 'agg' AS kind, trade_id, entry_ms, exit_ms, entry_px, direction,
               min_px, max_px, NULL::BIGINT AS ts_ms, NULL::DOUBLE AS price
        FROM agg
        UNION ALL
        SELECT 'pt' AS kind, trade_id, NULL::BIGINT, NULL::BIGINT, entry_px, direction,
               NULL::DOUBLE, NULL::DOUBLE, ts_ms, price
        FROM buckets
        ORDER BY kind, trade_id, ts_ms
    """
    try:
        rows = db.query(sql)
    except Exception:
        return {}, {}

    fill_by_id = {f.trade_id: f for f in fills}
    excursions: dict[int, dict[str, float]] = {}
    paths: dict[int, list[dict[str, Any]]] = {}
    path_raw: dict[int, list[tuple[int, float]]] = {}

    for row in rows:
        tid = int(row["trade_id"])
        direction = str(row["direction"])
        entry_px = float(row["entry_px"])
        if row["kind"] == "agg":
            min_px = float(row["min_px"])
            max_px = float(row["max_px"])
            if direction == "long":
                fav_px, adv_px = max_px, min_px
            else:
                fav_px, adv_px = min_px, max_px
            excursions[tid] = {
                "max_runup_usd": round(
                    _pnl_usd(symbol, direction, entry_px, fav_px, lots), 2
                ),
                "max_drawdown_usd": round(
                    _pnl_usd(symbol, direction, entry_px, adv_px, lots), 2
                ),
            }
            continue

        if row["ts_ms"] is None or row["price"] is None:
            continue
        ts_ms = int(row["ts_ms"])
        pnl = _pnl_usd(symbol, direction, entry_px, float(row["price"]), lots)
        path_raw.setdefault(tid, []).append((ts_ms, pnl))

    for tid, samples in path_raw.items():
        fill = fill_by_id.get(tid)
        if not fill or fill.entry_fill_ms is None:
            continue
        entry_ms = int(fill.entry_fill_ms)
        exit_ms = int(fill.exit_fill_ms or entry_ms)
        direction = fill.side
        entry_px = float(fill.fill_entry_price or 0.0)

        samples.sort(key=lambda x: x[0])
        series: list[tuple[int, float]] = [(entry_ms, 0.0)]
        for ts, pnl in samples:
            if ts <= entry_ms:
                continue
            series.append((ts, pnl))
        if fill.fill_exit_price is not None:
            end_pnl = _pnl_usd(
                symbol, direction, entry_px, float(fill.fill_exit_price), lots
            )
            if not series or series[-1][0] != exit_ms:
                series.append((exit_ms, end_pnl))
            else:
                series[-1] = (exit_ms, end_pnl)

        peak = 0.0
        pts: list[dict[str, Any]] = []
        seen: set[int] = set()
        for ts, pnl in series:
            if ts in seen:
                continue
            seen.add(ts)
            peak = max(peak, pnl)
            pts.append(
                {
                    "t": _fmt_ms(ts),
                    "equity": round(pnl, 2),
                    "drawdown": round(peak - pnl, 2),
                }
            )
        paths[tid] = pts

    return excursions, paths


def apply_sizing(
    symbol: str,
    fills: list[TradeFill],
    *,
    lots: float,
    commission_per_lot: float = 0.0,
    starting_balance: float = 2000.0,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    pip = _pip_size(symbol, settings)
    contract = _contract_size(symbol)

    trades: list[dict[str, Any]] = []
    equity = starting_balance
    curve: list[dict[str, Any]] = [
        {"t": "", "equity": starting_balance, "drawdown": 0.0, "pnl": 0.0}
    ]
    peak = starting_balance
    max_dd = 0.0
    max_dd_usd = 0.0
    wins = losses = 0
    gross_win = gross_loss = 0.0
    sim_total = 0.0
    tv_total = 0.0
    side_stats: dict[str, dict[str, float | int]] = {
        "long": {
            "filled": 0,
            "wins": 0,
            "losses": 0,
            "pnl_usd": 0.0,
            "gross_win": 0.0,
            "gross_loss": 0.0,
        },
        "short": {
            "filled": 0,
            "wins": 0,
            "losses": 0,
            "pnl_usd": 0.0,
            "gross_win": 0.0,
            "gross_loss": 0.0,
        },
    }

    for fill in fills:
        row = asdict(fill)
        row.pop("entry_fill_ms", None)
        row.pop("exit_fill_ms", None)
        tv_lots = (fill.tv_qty / contract) if fill.tv_qty else lots
        tv_scaled = (
            fill.tv_pnl_usd * (lots / tv_lots)
            if fill.tv_pnl_usd is not None and tv_lots
            else fill.tv_pnl_usd
        )
        row["tv_pnl_usd"] = (
            round(tv_scaled, 2) if tv_scaled is not None else None
        )
        if tv_scaled is not None:
            tv_total += tv_scaled

        if (
            fill.status != "ok"
            or fill.fill_entry_price is None
            or fill.fill_exit_price is None
        ):
            row["sim_pnl_usd"] = None
            row["commission_usd"] = None
            row["net_pnl_usd"] = None
            row["entry_slip_pips"] = None
            row["exit_slip_pips"] = None
            row["equity"] = round(equity, 2)
            row["pnl"] = None
            row["tv_net_pnl"] = row["tv_pnl_usd"]
            row["cumulative_pnl"] = round(equity - starting_balance, 2)
            row["open_time"] = fill.tv_entry_time
            row["close_time"] = fill.tv_exit_time
            row["open_price"] = fill.tv_entry_price
            row["close_price"] = fill.tv_exit_price
            row["size"] = fill.tv_qty
            trades.append(row)
            continue

        raw = _pnl_usd(
            symbol,
            fill.side,
            fill.fill_entry_price,
            fill.fill_exit_price,
            lots,
        )
        commission = commission_per_lot * lots * 2
        net = raw - commission
        equity += net
        sim_total += net
        peak = max(peak, equity)
        dd_usd = peak - equity
        max_dd_usd = max(max_dd_usd, dd_usd)
        dd_pct = (peak - equity) / peak if peak else 0.0
        max_dd = max(max_dd, dd_pct)

        if net >= 0:
            wins += 1
            gross_win += net
        else:
            losses += 1
            gross_loss += abs(net)

        side_key = fill.side if fill.side in side_stats else None
        if side_key is not None:
            ss = side_stats[side_key]
            ss["filled"] = int(ss["filled"]) + 1
            ss["pnl_usd"] = float(ss["pnl_usd"]) + net
            if net >= 0:
                ss["wins"] = int(ss["wins"]) + 1
                ss["gross_win"] = float(ss["gross_win"]) + net
            else:
                ss["losses"] = int(ss["losses"]) + 1
                ss["gross_loss"] = float(ss["gross_loss"]) + abs(net)

        entry_slip = (
            abs(fill.fill_entry_price - fill.tv_entry_price) / pip
            if fill.tv_entry_price is not None and pip
            else None
        )
        exit_slip = (
            abs(fill.fill_exit_price - fill.tv_exit_price) / pip
            if fill.tv_exit_price is not None and pip
            else None
        )

        row["sim_pnl_usd"] = round(raw, 2)
        row["commission_usd"] = round(commission, 2)
        row["net_pnl_usd"] = round(net, 2)
        row["entry_slip_pips"] = round(entry_slip, 2) if entry_slip is not None else None
        row["exit_slip_pips"] = round(exit_slip, 2) if exit_slip is not None else None
        row["equity"] = round(equity, 2)
        # Compat aliases for existing UI / tests
        row["pnl"] = round(net, 2)
        row["tv_net_pnl"] = row["tv_pnl_usd"]
        row["cumulative_pnl"] = round(equity - starting_balance, 2)
        row["open_time"] = fill.tv_entry_time
        row["close_time"] = fill.tv_exit_time
        row["open_price"] = fill.fill_entry_price
        row["close_price"] = fill.fill_exit_price
        row["size"] = lots * contract
        trades.append(row)

        t_label = fill.tv_exit_time or fill.fill_exit_time or ""
        curve.append(
            {
                "t": t_label,
                "equity": round(equity, 2),
                "drawdown": round((peak - equity), 2),
                "pnl": round(net, 2),
            }
        )

    closed = wins + losses
    if gross_loss > 0:
        pf: float | None = round(gross_win / gross_loss, 3)
    else:
        pf = None

    filled = sum(1 for f in fills if f.status == "ok")
    equity_out: list[dict[str, Any]] = []
    for i, p in enumerate(curve):
        t = p["t"]
        if not t:
            if i == 0 and len(curve) > 1 and curve[1]["t"]:
                # Anchor just before first fill for the chart parser
                try:
                    t0 = datetime.fromisoformat(curve[1]["t"].replace("Z", "+00:00"))
                    t = (t0 - timedelta(seconds=1)).isoformat()
                except ValueError:
                    continue
            else:
                continue
        equity_out.append(
            {
                "t": t,
                "equity": p["equity"],
                "drawdown": p.get("drawdown", 0.0),
            }
        )

    def _side_summary(key: str) -> dict[str, Any]:
        ss = side_stats[key]
        n = int(ss["filled"])
        w = int(ss["wins"])
        l_ = int(ss["losses"])
        closed_side = w + l_
        gw = float(ss["gross_win"])
        gl = float(ss["gross_loss"])
        pnl = float(ss["pnl_usd"])
        if gl > 0:
            side_pf: float | None = round(gw / gl, 3)
        elif gw > 0:
            side_pf = None
        else:
            side_pf = 0.0
        return {
            "filled": n,
            "share_pct": round(n / filled * 100, 1) if filled else 0.0,
            "pnl_usd": round(pnl, 2),
            "pnl_share_pct": round(pnl / sim_total * 100, 1)
            if sim_total
            else 0.0,
            "win_rate": round(w / closed_side, 4) if closed_side else 0.0,
            "wins": w,
            "losses": l_,
            "profit_factor": side_pf,
        }

    return {
        "symbol": symbol,
        "strategy_id": "",  # filled by caller
        "settings": {
            "lots": lots,
            "commission_per_lot": commission_per_lot,
            "starting_balance": starting_balance,
            "contract_size": contract,
            "pip_size": pip,
        },
        "summary": {
            "trades": len(fills),
            "filled": filled,
            "skipped": len(fills) - filled,
            "sim_pnl_usd": round(sim_total, 2),
            "tv_pnl_usd": round(tv_total, 2),
            "pnl_diff_usd": round(sim_total - tv_total, 2),
            "win_rate": round(wins / closed, 4) if closed else 0.0,
            "wins": wins,
            "losses": losses,
            "profit_factor": pf,
            "max_drawdown_pct": round(max_dd * 100, 2),
            "max_drawdown_usd": round(max_dd_usd, 2),
            "ending_equity": round(equity, 2),
            "return_pct": round(
                (equity - starting_balance) / starting_balance * 100, 2
            )
            if starting_balance
            else 0.0,
            "by_side": {
                "long": _side_summary("long"),
                "short": _side_summary("short"),
            },
        },
        # Compat top-level fields
        "trade_count": len(fills),
        "closed_count": closed,
        "total_pnl": round(sim_total, 2),
        "max_drawdown": round(max_dd_usd, 2),
        "trades": trades,
        "equity": equity_out,
    }


def simulate(
    symbol: str,
    strategy_id: str,
    *,
    lots: float = 0.1,
    commission_per_lot: float = 7.0,
    starting_balance: float = 2000.0,
    chart_tf_minutes: int = 10,
    from_ts: str | None = None,
    to_ts: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    fills = simulate_fills(
        symbol,
        strategy_id,
        chart_tf_minutes=chart_tf_minutes,
        from_ts=from_ts,
        to_ts=to_ts,
        settings=settings,
    )
    excursions, trade_paths = compute_excursions(
        symbol,
        fills,
        lots=lots,
        settings=settings,
    )
    for fill in fills:
        ex = excursions.get(fill.trade_id)
        if ex:
            fill.max_runup_usd = ex["max_runup_usd"]
            fill.max_drawdown_usd = ex["max_drawdown_usd"]

    result = apply_sizing(
        symbol,
        fills,
        lots=lots,
        commission_per_lot=commission_per_lot,
        starting_balance=starting_balance,
        settings=settings,
    )
    result["strategy_id"] = strategy_id
    result["settings"]["chart_tf_minutes"] = chart_tf_minutes
    # Per-trade floating PnL paths (trade-wise equity curve when a trade is selected)
    result["trade_equity"] = {
        str(tid): pts for tid, pts in trade_paths.items()
    }
    if chart_tf_minutes > 0:
        rule = (
            f"bar-close fill: TV time + {chart_tf_minutes}m | "
            "long ask/bid | short bid/ask | first tick at/after close"
        )
    else:
        rule = (
            "fill at TV time (TF=0, no bar-close offset) | "
            "long ask/bid | short bid/ask | first tick at/after signal"
        )
    result["meta"] = {"rule": rule}
    return result
