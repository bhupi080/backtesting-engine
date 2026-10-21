"""ATR take-profit / stop simulation on TradingView entries.

ATR is Wilder's average true range of BID bars that have already closed
before the fill. TP and SL prices stay fixed for the trade. The first tick
that reaches either level closes the trade; otherwise the CSV exit is used.
"""

from __future__ import annotations

from typing import Any

from app import duckdb_client as db
from app.config import Settings, get_settings
from app.tick_sim import (
    TradeFill,
    _day_files_for_range,
    _fmt_ms,
    _mark_side,
    _pnl_usd,
    apply_sizing,
    attribute_session_pnls,
    compute_excursions,
    simulate_fills,
)

Bar = tuple[int, float, float, float]  # open_ms, high, low, close


def wilder_atr(bars: list[Bar], period: int) -> list[float | None]:
    """Wilder ATR aligned to each bar. None until `period` true ranges exist."""
    n = len(bars)
    out: list[float | None] = [None] * n
    if period < 1 or n < period + 1:
        return out
    trs: list[float] = []
    for i in range(1, n):
        high, low = bars[i][1], bars[i][2]
        prev_close = bars[i - 1][3]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
        if len(trs) == period:
            out[i] = sum(trs) / period
        elif len(trs) > period and out[i - 1] is not None:
            out[i] = (out[i - 1] * (period - 1) + tr) / period
    return out


def atr_asof(
    bars: list[Bar],
    atrs: list[float | None],
    entry_ms: int,
    bar_ms: int,
) -> float | None:
    """ATR of the last bar whose close is at or before entry_ms."""
    chosen: float | None = None
    for i, bar in enumerate(bars):
        if bar[0] + bar_ms <= entry_ms:
            if atrs[i] is not None:
                chosen = atrs[i]
        elif bar[0] >= entry_ms:
            break
    return chosen


def level_prices(
    side: str, entry: float, atr: float, tp_mult: float, sl_mult: float
) -> tuple[float, float]:
    span_tp = atr * tp_mult
    span_sl = atr * sl_mult
    if side == "long":
        return entry + span_tp, entry - span_sl
    return entry - span_tp, entry + span_sl


def _load_bid_bars(
    symbol: str,
    start_ms: int,
    end_ms: int,
    bar_ms: int,
    settings: Settings,
) -> list[Bar]:
    files = _day_files_for_range(symbol, start_ms, end_ms, settings)
    if not files or bar_ms <= 0:
        return []
    files_sql = ", ".join(f"'{p}'" for p in files)
    sql = f"""
        SELECT (timestamp_ms // {int(bar_ms)}) * {int(bar_ms)} AS open_ms,
               max(price) AS high,
               min(price) AS low,
               arg_max(price, timestamp_ms) AS close
        FROM read_parquet([{files_sql}])
        WHERE upper(side::VARCHAR) = 'BID'
          AND timestamp_ms >= {int(start_ms)}
          AND timestamp_ms < {int(end_ms)}
        GROUP BY 1
        ORDER BY 1
    """
    try:
        rows = db.query(sql)
    except Exception:
        return []
    bars: list[Bar] = []
    for row in rows:
        if row["open_ms"] is None or row["high"] is None:
            continue
        bars.append(
            (
                int(row["open_ms"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
            )
        )
    return bars


def _sql_num(value: float) -> str:
    return f"{float(value):.10f}"


def _first_hits(
    symbol: str,
    levels: list[tuple[int, int, int, float, float, str, str]],
    settings: Settings,
) -> dict[int, tuple[str, int, float]]:
    """trade_id → (reason, timestamp_ms, price). SL wins when both share a tick."""
    if not levels:
        return {}
    min_ms = min(row[1] for row in levels)
    max_ms = max(row[2] for row in levels)
    files = _day_files_for_range(symbol, min_ms, max_ms, settings)
    if not files:
        return {}
    values_sql = ", ".join(
        "("
        f"{int(tid)}, {int(entry_ms)}::BIGINT, {int(deadline_ms)}::BIGINT, "
        f"{_sql_num(tp)}::DOUBLE, {_sql_num(sl)}::DOUBLE, "
        f"'{direction}', '{mark}'"
        ")"
        for tid, entry_ms, deadline_ms, tp, sl, direction, mark in levels
    )
    files_sql = ", ".join(f"'{p}'" for p in files)
    sql = f"""
        WITH levels AS (
          SELECT * FROM (VALUES {values_sql})
            AS t(trade_id, entry_ms, deadline_ms, tp, sl, direction, mark_side)
        ),
        ticks AS (
          SELECT timestamp_ms::BIGINT AS timestamp_ms,
                 price::DOUBLE AS price,
                 upper(side::VARCHAR) AS side
          FROM read_parquet([{files_sql}])
          WHERE timestamp_ms > {int(min_ms)} AND timestamp_ms <= {int(max_ms)}
        ),
        hits AS (
          SELECT l.trade_id,
                 CASE
                   WHEN l.direction = 'long' AND t.price >= l.tp THEN 'tp'
                   WHEN l.direction = 'long' AND t.price <= l.sl THEN 'sl'
                   WHEN l.direction = 'short' AND t.price <= l.tp THEN 'tp'
                   WHEN l.direction = 'short' AND t.price >= l.sl THEN 'sl'
                 END AS reason,
                 t.timestamp_ms,
                 t.price
          FROM levels l
          JOIN ticks t
            ON t.side = l.mark_side
           AND t.timestamp_ms > l.entry_ms
           AND t.timestamp_ms <= l.deadline_ms
        )
        SELECT trade_id, reason,
               min(timestamp_ms) AS ts_ms,
               arg_min(price, timestamp_ms) AS price
        FROM hits
        WHERE reason IS NOT NULL
        GROUP BY trade_id, reason
    """
    try:
        rows = db.query(sql)
    except Exception:
        return {}

    best: dict[int, tuple[str, int, float]] = {}
    for row in rows:
        if row["ts_ms"] is None or row["price"] is None or row["reason"] is None:
            continue
        tid = int(row["trade_id"])
        reason = str(row["reason"])
        ts_ms = int(row["ts_ms"])
        price = float(row["price"])
        current = best.get(tid)
        if current is None or ts_ms < current[1] or (ts_ms == current[1] and reason == "sl"):
            best[tid] = (reason, ts_ms, price)
    return best


def _apply_atr_exits(
    symbol: str,
    fills: list[TradeFill],
    *,
    lots: float,
    atr_bar_minutes: int,
    atr_period: int,
    tp_atr_mult: float,
    sl_atr_mult: float,
    settings: Settings,
) -> dict[int, dict[str, Any]]:
    """Rewrite exits that touch TP/SL before the CSV exit. Returns per-trade extras."""
    extras: dict[int, dict[str, Any]] = {}
    ready: list[TradeFill] = []
    for fill in fills:
        if (
            fill.status != "ok"
            or fill.fill_entry_price is None
            or fill.entry_fill_ms is None
            or fill.exit_fill_ms is None
            or fill.exit_fill_ms <= fill.entry_fill_ms
            or fill.side not in {"long", "short"}
        ):
            continue
        ready.append(fill)
    if not ready:
        return extras

    bar_ms = int(atr_bar_minutes) * 60_000
    warmup = bar_ms * (int(atr_period) * 5 + 2)
    start_ms = min(int(f.entry_fill_ms or 0) for f in ready) - warmup
    end_ms = max(int(f.entry_fill_ms or 0) for f in ready) + bar_ms
    bars = _load_bid_bars(symbol, start_ms, end_ms, bar_ms, settings)
    atrs = wilder_atr(bars, int(atr_period))

    levels: list[tuple[int, int, int, float, float, str, str]] = []
    for fill in ready:
        entry_ms = int(fill.entry_fill_ms or 0)
        atr = atr_asof(bars, atrs, entry_ms, bar_ms)
        if atr is None or atr <= 0 or fill.fill_entry_price is None:
            fill.status = "no_atr"
            extras[fill.trade_id] = {
                "atr": None,
                "tp_price": None,
                "sl_price": None,
                "exit_reason": "no_atr",
            }
            continue
        tp, sl = level_prices(
            fill.side, float(fill.fill_entry_price), atr, tp_atr_mult, sl_atr_mult
        )
        entry_px = float(fill.fill_entry_price)
        extras[fill.trade_id] = {
            "atr": round(atr, 6),
            "tp_price": tp,
            "sl_price": sl,
            "tp_pnl_usd": round(_pnl_usd(symbol, fill.side, entry_px, tp, lots), 2),
            "sl_pnl_usd": round(_pnl_usd(symbol, fill.side, entry_px, sl, lots), 2),
            "exit_reason": "signal",
        }
        levels.append(
            (
                fill.trade_id,
                entry_ms,
                int(fill.exit_fill_ms or entry_ms),
                tp,
                sl,
                fill.side,
                _mark_side(fill.side),
            )
        )

    hits = _first_hits(symbol, levels, settings)
    by_id = {f.trade_id: f for f in ready}
    for tid, (reason, ts_ms, price) in hits.items():
        fill = by_id.get(tid)
        extra = extras.get(tid)
        if fill is None or extra is None:
            continue
        fill.fill_exit_price = price
        fill.exit_fill_ms = ts_ms
        fill.fill_exit_time = _fmt_ms(ts_ms, settings)
        fill.exit_side = _mark_side(fill.side).lower()
        extra["exit_reason"] = reason
    return extras


def _stamp_equity_exits(
    equity: list[dict[str, Any]],
    fills: list[TradeFill],
    extras: dict[int, dict[str, Any]],
) -> None:
    sized = [
        f
        for f in fills
        if f.status == "ok"
        and f.fill_entry_price is not None
        and f.fill_exit_price is not None
        and f.fill_exit_time
    ]
    if len(equity) != len(sized) + 1:
        return
    for i, fill in enumerate(sized):
        point = equity[i + 1]
        point["t"] = fill.fill_exit_time
        reason = (extras.get(fill.trade_id) or {}).get("exit_reason")
        if reason in {"tp", "sl", "signal"}:
            point["exit_reason"] = reason


def simulate_risk_reward(
    symbol: str,
    strategy_id: str,
    *,
    lots: float = 0.1,
    commission_per_lot: float = 7.0,
    starting_balance: float = 2000.0,
    chart_tf_minutes: int = 10,
    analysis_tz: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    atr_bar_minutes: int = 60,
    atr_period: int = 14,
    tp_atr_mult: float = 2.0,
    sl_atr_mult: float = 1.0,
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
    csv_exit: dict[int, tuple[int, str | None, float | None, str | None]] = {}
    for fill in fills:
        if fill.status == "ok" and fill.exit_fill_ms is not None:
            csv_exit[fill.trade_id] = (
                int(fill.exit_fill_ms),
                fill.fill_exit_time,
                fill.fill_exit_price,
                fill.exit_side,
            )
    extras = _apply_atr_exits(
        symbol,
        fills,
        lots=lots,
        atr_bar_minutes=atr_bar_minutes,
        atr_period=atr_period,
        tp_atr_mult=tp_atr_mult,
        sl_atr_mult=sl_atr_mult,
        settings=settings,
    )
    # Chart path runs through the original CSV exit. PnL still uses the ATR exit.
    atr_exit: dict[int, tuple[int | None, str | None, float | None, str | None]] = {}
    for fill in fills:
        orig = csv_exit.get(fill.trade_id)
        if orig is None:
            continue
        atr_exit[fill.trade_id] = (
            fill.exit_fill_ms,
            fill.fill_exit_time,
            fill.fill_exit_price,
            fill.exit_side,
        )
        (
            fill.exit_fill_ms,
            fill.fill_exit_time,
            fill.fill_exit_price,
            fill.exit_side,
        ) = orig
    excursions, trade_paths = compute_excursions(
        symbol,
        fills,
        lots=lots,
        settings=settings,
    )
    shortened = False
    for fill in fills:
        saved = atr_exit.get(fill.trade_id)
        orig = csv_exit.get(fill.trade_id)
        if saved is None:
            continue
        if orig is not None and saved[0] != orig[0]:
            shortened = True
        (
            fill.exit_fill_ms,
            fill.fill_exit_time,
            fill.fill_exit_price,
            fill.exit_side,
        ) = saved
    if shortened:
        excursions, _atr_paths = compute_excursions(
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
        analysis_tz=analysis_tz,
        settings=settings,
    )
    for row in result["trades"]:
        extra = extras.get(int(row["trade_id"]))
        if extra:
            row.update(extra)

    _stamp_equity_exits(result["equity"], fills, extras)

    result["strategy_id"] = strategy_id
    result["settings"]["chart_tf_minutes"] = chart_tf_minutes
    result["settings"]["atr_bar_minutes"] = atr_bar_minutes
    result["settings"]["atr_period"] = atr_period
    result["settings"]["tp_atr_mult"] = tp_atr_mult
    result["settings"]["sl_atr_mult"] = sl_atr_mult
    result["trade_equity"] = {str(tid): pts for tid, pts in trade_paths.items()}

    summary = result.get("summary") or {}
    analytics = summary.get("analytics") or {}
    filled_for_sessions = [
        {
            "trade_id": f.trade_id,
            "gross": _pnl_usd(
                symbol,
                f.side,
                float(f.fill_entry_price),
                float(f.fill_exit_price),
                lots,
            ),
            "entry_ms": f.entry_fill_ms,
            "exit_ms": f.exit_fill_ms,
        }
        for f in fills
        if (
            f.status == "ok"
            and f.fill_entry_price is not None
            and f.fill_exit_price is not None
            and f.entry_fill_ms is not None
            and f.exit_fill_ms is not None
        )
    ]
    analytics["session_pnls"] = attribute_session_pnls(
        filled_for_sessions, trade_paths
    )
    summary["analytics"] = analytics
    result["summary"] = summary

    counts = {"tp": 0, "sl": 0, "signal": 0, "no_atr": 0}
    for extra in extras.values():
        reason = str(extra.get("exit_reason") or "")
        if reason in counts:
            counts[reason] += 1
    if chart_tf_minutes > 0:
        fill_rule = f"bar-close fill: TV time + {chart_tf_minutes}m"
    else:
        fill_rule = "fill at TV time"
    result["meta"] = {
        "rule": (
            f"ATR {atr_period} on {atr_bar_minutes}m BID bars closed before entry | "
            f"TP ×{tp_atr_mult:g} · SL ×{sl_atr_mult:g} | "
            f"else CSV exit | {fill_rule}"
        ),
        "exits": counts,
    }
    return result
