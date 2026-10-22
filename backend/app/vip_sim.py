"""Run every VIP line through the risk/reward fill and add the books together."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app import account_targets, risk_reward, tick_sim
from app.config import Settings, get_settings
from app.tick_sim import _SESSION_ASIA, _SESSION_EU, _compute_analytics


def validate_line(line: dict[str, Any]) -> None:
    symbol = str(line.get("symbol") or "").strip()
    strategy = str(line.get("strategy_id") or "").strip()
    if not symbol or not strategy:
        raise ValueError("Each line needs a symbol and a strategy")
    _bounds(line, "lots", 0.01, 10.0)
    _bounds(line, "commission_per_lot", 0.0, 50.0)
    _bounds(line, "chart_tf_minutes", 0, 240, as_int=True)
    mode = str(line.get("exit_mode") or "atr")
    if mode not in {"atr", "csv"}:
        raise ValueError("Each symbol uses ATR exits or the CSV exit")
    line["exit_mode"] = mode
    if mode == "atr":
        _bounds(line, "atr_bar_minutes", 1, 1440, as_int=True)
        _bounds(line, "atr_period", 2, 500, as_int=True)
        _bounds(line, "tp_atr_mult", 0.0, 50.0, gt=True)
        _bounds(line, "sl_atr_mult", 0.0, 50.0, gt=True)


def validate_lines(lines: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for line in lines:
        line_id = str(line.get("id") or "").strip()
        if not line_id:
            raise ValueError("Each line needs an id")
        if line_id in seen:
            raise ValueError("Line ids must be unique")
        seen.add(line_id)
        validate_line(line)


def run_vip(
    vip: dict[str, Any],
    *,
    analysis_tz: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    targets = account_targets.configured_targets(vip)
    books = _simulate_vip(vip, analysis_tz=analysis_tz, settings=settings)
    account_target = None
    if targets is not None:
        take_profit, stop = targets
        signal_hit = account_targets.apply_account_targets(books["signal_ok"], take_profit, stop)
        bar_hit = (
            account_targets.apply_account_targets(books["bar_ok"], take_profit, stop)
            if books["bar_ok"]
            else None
        )
        account_target = {
            "enabled": True,
            "take_profit": take_profit,
            "stop": stop,
            "signal": signal_hit,
            "bar_close": bar_hit,
        }
    return _pack_vip(vip, books, account_target=account_target)


def suggest_vip_targets(
    vip: dict[str, Any],
    *,
    tp_from: float,
    tp_to: float,
    sl_from: float,
    sl_to: float,
    step: float,
    analysis_tz: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Replay dollar pairs on one simulation. Does not apply the saved checkbox."""
    settings = settings or get_settings()
    take_profits = account_targets.dollar_steps(tp_from, tp_to, step)
    stops = account_targets.dollar_steps(sl_from, sl_to, step)
    books = _simulate_vip(vip, analysis_tz=analysis_tz, settings=settings)
    return {
        "tp": take_profits,
        "sl": stops,
        "step": step,
        "signal": account_targets.target_grid(books["signal_ok"], take_profits, stops),
        "bar_close": account_targets.target_grid(books["bar_ok"], take_profits, stops) if books["bar_ok"] else None,
    }


def _simulate_vip(
    vip: dict[str, Any],
    *,
    analysis_tz: str | None,
    settings: Settings,
) -> dict[str, Any]:
    lines = list(vip.get("lines") or [])
    validate_lines(lines)
    if not lines:
        raise ValueError("Add at least one symbol before running")
    balance = _account_balance(vip)
    ran: list[dict[str, Any]] = []
    signal_ok: list[dict[str, Any]] = []
    bar_ok: list[dict[str, Any]] = []
    for line in lines:
        signal, signal_error = _simulate_line(
            line, 0, analysis_tz=analysis_tz, settings=settings, starting_balance=balance
        )
        line_tf = int(line.get("chart_tf_minutes") or 0)
        bar_close = None
        bar_error = None
        if line_tf > 0:
            bar_close, bar_error = _simulate_line(
                line,
                line_tf,
                analysis_tz=analysis_tz,
                settings=settings,
                starting_balance=balance,
            )
        if signal is not None:
            signal_ok.append(signal)
        if bar_close is not None:
            bar_ok.append(bar_close)
        ran.append(
            {
                "line": line,
                "signal": signal,
                "bar_close": bar_close,
                "error": " · ".join(part for part in (signal_error, bar_error) if part) or None,
            }
        )
    positive = {int(line.get("chart_tf_minutes") or 0) for line in lines if int(line.get("chart_tf_minutes") or 0) > 0}
    return {
        "ran": ran,
        "signal_ok": signal_ok,
        "bar_ok": bar_ok,
        "balance": balance,
        "lines": lines,
        "tz": analysis_tz or settings.tv_trades_tz,
        "chart_tf_minutes": next(iter(positive)) if len(positive) == 1 else 0,
    }


def _pack_vip(
    vip: dict[str, Any],
    books: dict[str, Any],
    *,
    account_target: dict[str, Any] | None,
) -> dict[str, Any]:
    name = str(vip.get("name") or "VIP")
    balance = books["balance"]
    tz = books["tz"]
    signal_ok = books["signal_ok"]
    bar_ok = books["bar_ok"]
    signal_book = combine_books(signal_ok, name=name, analysis_tz=tz, starting_balance=balance)
    bar_book = combine_books(bar_ok, name=name, analysis_tz=tz, starting_balance=balance) if bar_ok else None
    for result in (*signal_ok, *bar_ok):
        result["trade_equity"] = {}
    return {
        "vip_id": vip["id"],
        "name": vip.get("name") or "",
        "chart_tf_minutes": books["chart_tf_minutes"],
        "lines": books["ran"],
        "signal": signal_book,
        "bar_close": bar_book,
        "account_target": account_target,
    }


def _account_balance(vip: dict[str, Any]) -> float:
    raw = vip.get("starting_balance", 2000.0)
    try:
        balance = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("Starting balance must be a number") from exc
    if not 100.0 <= balance <= 1_000_000.0:
        raise ValueError("Starting balance must be between 100 and 1,000,000")
    return balance


def _simulate_line(
    line: dict[str, Any],
    chart_tf_minutes: int,
    *,
    analysis_tz: str | None,
    settings: Settings,
    starting_balance: float,
) -> tuple[dict[str, Any] | None, str | None]:
    try:
        common = dict(
            lots=float(line["lots"]),
            commission_per_lot=float(line["commission_per_lot"]),
            starting_balance=starting_balance,
            chart_tf_minutes=chart_tf_minutes,
            analysis_tz=analysis_tz,
            settings=settings,
        )
        if str(line.get("exit_mode") or "atr") == "csv":
            result = tick_sim.simulate(str(line["symbol"]), str(line["strategy_id"]), **common)
        else:
            result = risk_reward.simulate_risk_reward(
                str(line["symbol"]),
                str(line["strategy_id"]),
                atr_bar_minutes=int(line["atr_bar_minutes"]),
                atr_period=int(line["atr_period"]),
                tp_atr_mult=float(line["tp_atr_mult"]),
                sl_atr_mult=float(line["sl_atr_mult"]),
                **common,
            )
    except Exception as exc:  # noqa: BLE001 — one bad symbol should not drop the rest
        return None, str(exc)
    for trade in result.get("trades") or []:
        trade["symbol"] = line["symbol"]
        trade["strategy_id"] = line["strategy_id"]
    return result, None


def combine_books(
    results: list[dict[str, Any]],
    *,
    name: str,
    analysis_tz: str,
    starting_balance: float | None = None,
) -> dict[str, Any]:
    """Sum each line's closed-trade PnL on one clock. Overlaps both count."""
    if starting_balance is None:
        starting = sum(float((r.get("settings") or {}).get("starting_balance") or 0.0) for r in results)
    else:
        starting = float(starting_balance)
    curves = [_pnl_steps(r) for r in results]
    equity, max_dd_usd, max_dd_pct = _sum_curves(curves, starting)

    merged = _merge_trades(results)
    filled = [t for t in merged if t.get("status") == "ok" and t.get("net_pnl_usd") is not None]
    wins = [t for t in filled if float(t["net_pnl_usd"]) >= 0]
    losses = [t for t in filled if float(t["net_pnl_usd"]) < 0]
    sim_total = sum(float(t["net_pnl_usd"]) for t in filled)
    tv_total = sum(float(t["tv_pnl_usd"] or 0.0) for t in filled if t.get("tv_pnl_usd") is not None)
    gross_win = sum(float(t["net_pnl_usd"]) for t in wins)
    gross_loss = sum(abs(float(t["net_pnl_usd"])) for t in losses)
    closed = len(wins) + len(losses)
    trade_count = sum(len(r.get("trades") or []) for r in results)
    skipped = trade_count - len(filled)

    records = []
    for trade in filled:
        records.append(
            {
                "trade_id": int(trade["trade_id"]),
                "side": trade.get("side"),
                "net": float(trade["net_pnl_usd"]),
                "gross": float(trade["sim_pnl_usd"] or 0.0),
                "entry_ms": _ms(trade.get("fill_entry_time")),
                "exit_ms": _ms(trade.get("fill_exit_time")),
                "exit_time": trade.get("fill_exit_time"),
            }
        )
    analytics = _compute_analytics(
        records,
        sim_total=sim_total,
        wins=len(wins),
        losses=len(losses),
        gross_win=gross_win,
        gross_loss=gross_loss,
        analysis_tz=analysis_tz,
    )
    sessions = {_SESSION_ASIA: 0.0, _SESSION_EU: 0.0}
    for result in results:
        src = ((result.get("summary") or {}).get("analytics") or {}).get("session_pnls") or {}
        for key in sessions:
            sessions[key] += float(src.get(key) or 0.0)
    analytics["session_pnls"] = {key: round(value, 2) for key, value in sessions.items()}

    ending = starting + sim_total
    if gross_loss > 0:
        profit_factor: float | None = round(gross_win / gross_loss, 3)
    else:
        profit_factor = None

    trade_equity: dict[str, Any] = {}
    for trade in merged:
        path = trade.pop("_path", None)
        if path:
            trade_equity[str(trade["trade_id"])] = path

    return {
        "symbol": "VIP",
        "strategy_id": name,
        "settings": {
            "lots": 0.0,
            "analysis_tz": analysis_tz,
            "commission_per_lot": 0.0,
            "starting_balance": round(starting, 2),
            "contract_size": 1,
            "pip_size": 0.0,
            "chart_tf_minutes": 0,
        },
        "summary": {
            "trades": trade_count,
            "filled": len(filled),
            "skipped": skipped,
            "sim_pnl_usd": round(sim_total, 2),
            "tv_pnl_usd": round(tv_total, 2),
            "pnl_diff_usd": round(sim_total - tv_total, 2),
            "win_rate": round(len(wins) / closed, 4) if closed else 0.0,
            "wins": len(wins),
            "losses": len(losses),
            "profit_factor": profit_factor,
            "max_drawdown_pct": round(max_dd_pct, 2),
            "max_drawdown_usd": round(max_dd_usd, 2),
            "ending_equity": round(ending, 2),
            "return_pct": round(sim_total / starting * 100, 2) if starting else 0.0,
            "by_side": _by_side(filled, sim_total),
            "analytics": analytics,
        },
        "trade_count": trade_count,
        "closed_count": closed,
        "total_pnl": round(sim_total, 2),
        "max_drawdown": round(max_dd_usd, 2),
        "trades": merged,
        "equity": equity,
        "trade_equity": trade_equity,
        "meta": {"rule": "Sum of each line. Overlapping trades both count."},
    }


def _pnl_steps(result: dict[str, Any]) -> list[tuple[datetime, float, str | None]]:
    start = float((result.get("settings") or {}).get("starting_balance") or 0.0)
    steps: list[tuple[datetime, float, str | None]] = []
    for point in result.get("equity") or []:
        stamp = point.get("t")
        when = _parse(stamp)
        if when is None:
            continue
        reason = point.get("exit_reason")
        steps.append((when, float(point["equity"]) - start, reason if reason in {"tp", "sl", "signal"} else None))
    steps.sort(key=lambda item: item[0])
    return steps


def _sum_curves(
    curves: list[list[tuple[datetime, float, str | None]]],
    starting_balance: float,
) -> tuple[list[dict[str, Any]], float, float]:
    times = sorted({step[0] for curve in curves for step in curve})
    if not times:
        return [], 0.0, 0.0
    index = [0] * len(curves)
    last = [0.0] * len(curves)
    equity: list[dict[str, Any]] = []
    peak = starting_balance
    max_dd = 0.0
    max_dd_pct = 0.0
    for when in times:
        reasons: list[str] = []
        for i, curve in enumerate(curves):
            while index[i] < len(curve) and curve[index[i]][0] <= when:
                last[i] = curve[index[i]][1]
                if curve[index[i]][0] == when and curve[index[i]][2]:
                    reasons.append(curve[index[i]][2])
                index[i] += 1
        account = starting_balance + sum(last)
        peak = max(peak, account)
        dd = peak - account
        max_dd = max(max_dd, dd)
        if peak:
            max_dd_pct = max(max_dd_pct, dd / peak * 100)
        equity.append(
            {
                "t": when.isoformat(),
                "equity": round(account, 2),
                "drawdown": round(dd, 2),
                "exit_reason": reasons[0] if len(reasons) == 1 else None,
            }
        )
    return equity, max_dd, max_dd_pct


def _merge_trades(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pending: list[tuple[datetime, dict[str, Any]]] = []
    skipped: list[dict[str, Any]] = []
    for result in results:
        paths = result.get("trade_equity") or {}
        for trade in result.get("trades") or []:
            row = dict(trade)
            row["_path"] = paths.get(str(trade.get("trade_id")))
            if row.get("status") == "ok" and row.get("net_pnl_usd") is not None:
                pending.append((_parse(row.get("fill_exit_time")) or _aware_min(), row))
            else:
                skipped.append(row)
    pending.sort(key=lambda item: item[0])
    merged: list[dict[str, Any]] = []
    running = 0.0
    for i, (_, row) in enumerate(pending, start=1):
        running += float(row["net_pnl_usd"])
        row["trade_id"] = i
        row["cumulative_pnl"] = round(running, 2)
        merged.append(row)
    for i, row in enumerate(skipped, start=len(merged) + 1):
        row["trade_id"] = i
        row["cumulative_pnl"] = round(running, 2)
        merged.append(row)
    return merged


def _aware_min() -> datetime:
    parsed = _parse("1970-01-01T00:00:00+00:00")
    assert parsed is not None
    return parsed


def _by_side(filled: list[dict[str, Any]], sim_total: float) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    n_all = len(filled)
    for key in ("long", "short"):
        rows = [t for t in filled if str(t.get("side") or "").lower() == key]
        wins = [t for t in rows if float(t["net_pnl_usd"]) >= 0]
        losses = [t for t in rows if float(t["net_pnl_usd"]) < 0]
        pnl = sum(float(t["net_pnl_usd"]) for t in rows)
        gross_win = sum(float(t["net_pnl_usd"]) for t in wins)
        gross_loss = sum(abs(float(t["net_pnl_usd"])) for t in losses)
        closed = len(wins) + len(losses)
        if gross_loss > 0:
            factor: float | None = round(gross_win / gross_loss, 3)
        elif gross_win > 0:
            factor = None
        else:
            factor = 0.0
        out[key] = {
            "filled": len(rows),
            "share_pct": round(len(rows) / n_all * 100, 1) if n_all else 0.0,
            "pnl_usd": round(pnl, 2),
            "pnl_share_pct": round(pnl / sim_total * 100, 1) if sim_total else 0.0,
            "win_rate": round(len(wins) / closed, 4) if closed else 0.0,
            "wins": len(wins),
            "losses": len(losses),
            "profit_factor": factor,
        }
    return out


def _bounds(
    line: dict[str, Any],
    key: str,
    low: float,
    high: float,
    *,
    as_int: bool = False,
    gt: bool = False,
) -> None:
    try:
        value = int(line[key]) if as_int else float(line[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"{key} is not a number") from exc
    if gt:
        if not (low < value <= high):
            raise ValueError(f"{key} must be greater than {low} and at most {high}")
    elif not (low <= value <= high):
        raise ValueError(f"{key} must be between {low} and {high}")
    line[key] = value


def _parse(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _ms(value: Any) -> int | None:
    parsed = _parse(value)
    if parsed is None:
        return None
    return int(parsed.timestamp() * 1000)
