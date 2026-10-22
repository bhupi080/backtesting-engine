"""Account dollar take profit and stop, replayed on trades that are already simulated.

The checkbox-off run never calls this. Each suggestion cell replays the same
paths, so the grid does not simulate the symbols again and does not change them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.tick_sim import _fmt_ms


def configured_targets(vip: dict[str, Any]) -> tuple[float, float] | None:
    """Return (take profit, stop) when the account checkbox is on."""
    if not vip.get("account_targets_enabled"):
        return None
    try:
        take_profit = float(vip.get("account_tp_usd"))
        stop = float(vip.get("account_sl_usd"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Take profit and stop must both be greater than zero") from exc
    if take_profit <= 0 or stop <= 0:
        raise ValueError("Take profit and stop must both be greater than zero")
    return take_profit, stop


def dollar_steps(start: float, end: float, step: float) -> list[float]:
    if step <= 0:
        raise ValueError("Step must be greater than zero")
    if start <= 0 or end <= 0:
        raise ValueError("Take profit and stop must be greater than zero")
    if end < start:
        raise ValueError("The end of the range must be at least the start")
    values: list[float] = []
    n = 0
    while True:
        value = round(start + n * step, 2)
        if value > end + 1e-9:
            break
        values.append(value)
        n += 1
        if n > 40:
            raise ValueError("Use a larger step. A range can have at most 40 values.")
    if not values:
        raise ValueError("The range is empty")
    return values


def scan_account_target(results: list[dict[str, Any]], take_profit: float, stop: float) -> dict[str, Any]:
    templates, times = _prepare(results)
    outcome, _state = _replay(templates, times, take_profit, stop)
    return {"hit": outcome["hit"], "profit": outcome["profit"]}


def target_grid(
    results: list[dict[str, Any]],
    take_profits: list[float],
    stops: list[float],
) -> list[list[dict[str, Any]]]:
    templates, times = _prepare(results)
    rows: list[list[dict[str, Any]]] = []
    for take_profit in take_profits:
        row = []
        for stop in stops:
            outcome, _state = _replay(templates, times, take_profit, stop)
            row.append({"hit": outcome["hit"], "profit": outcome["profit"]})
        rows.append(row)
    return rows


def apply_account_targets(
    results: list[dict[str, Any]],
    take_profit: float,
    stop: float,
) -> dict[str, Any]:
    """Flatten open trades when the account profit crosses a target.

    No hit leaves every trade and equity curve as the simulator wrote them.
    """
    templates, times = _prepare(results)
    outcome, state = _replay(templates, times, take_profit, stop)
    if outcome["hit"] == "none":
        return {"hit": "none", "profit": outcome["profit"]}

    hit_ms = int(outcome["ms"])
    reason = "account_tp" if outcome["hit"] == "tp" else "account_sl"
    grouped: dict[int, list[dict[str, Any]]] = {}
    for pos in state:
        grouped.setdefault(int(pos["result_index"]), []).append(pos)

    for result_index, result in enumerate(results):
        trades = list(result.get("trades") or [])
        paths = result.get("trade_equity") or {}
        for pos in grouped.get(result_index, []):
            trade = trades[int(pos["trade_index"])]
            if pos["done"]:
                continue
            if not pos["open"] or int(pos["entry"]) > hit_ms:
                _drop_trade(trade)
                continue
            gross = round(float(pos["gross"]), 2)
            net = round(gross - float(pos["commission"]), 2)
            trade["sim_pnl_usd"] = gross
            trade["net_pnl_usd"] = net
            trade["pnl"] = net
            trade["exit_reason"] = reason
            trade["fill_exit_time"] = _fmt_ms(hit_ms)
            if int(pos["exit"]) != hit_ms:
                trade["fill_exit_price"] = None
                trade["exit_slip_pips"] = None
            key = str(trade.get("trade_id"))
            if key in paths:
                paths[key] = _trim_path(paths[key], hit_ms, gross)
        _rebuild_equity(result)
    return {"hit": outcome["hit"], "profit": outcome["profit"]}


def _prepare(results: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[int]]:
    templates: list[dict[str, Any]] = []
    times: set[int] = set()
    for result_index, result in enumerate(results):
        paths = result.get("trade_equity") or {}
        for trade_index, trade in enumerate(result.get("trades") or []):
            if trade.get("status") != "ok" or trade.get("net_pnl_usd") is None:
                continue
            entry = _ms(trade.get("fill_entry_time"))
            exit_ = _ms(trade.get("fill_exit_time"))
            if entry is None or exit_ is None or exit_ < entry:
                continue
            raw = paths.get(str(trade.get("trade_id"))) or []
            path: list[tuple[int, float]] = []
            for point in raw:
                ms = _ms(point.get("t"))
                if ms is None or ms < entry or ms > exit_:
                    continue
                path.append((ms, float(point.get("equity") or 0.0)))
            path.sort()
            templates.append(
                {
                    "result_index": result_index,
                    "trade_index": trade_index,
                    "entry": entry,
                    "exit": exit_,
                    "net": float(trade["net_pnl_usd"]),
                    "commission": float(trade.get("commission_usd") or 0.0),
                    "path": path,
                }
            )
            times.add(entry)
            times.add(exit_)
            for ms, _gross in path:
                times.add(ms)
    return templates, sorted(times)


def _replay(
    templates: list[dict[str, Any]],
    times: list[int],
    take_profit: float,
    stop: float,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    state = [
        {**item, "gross": 0.0, "pi": 0, "open": False, "done": False}
        for item in templates
    ]
    realized = 0.0
    for ms in times:
        opened: list[dict[str, Any]] = []
        for pos in state:
            if pos["done"]:
                continue
            if int(pos["entry"]) <= ms:
                pos["open"] = True
            if not pos["open"]:
                continue
            path = pos["path"]
            while pos["pi"] < len(path) and path[pos["pi"]][0] <= ms:
                pos["gross"] = path[pos["pi"]][1]
                pos["pi"] += 1
            opened.append(pos)
        profit = _mark(realized, opened)
        kind = _cross(profit, take_profit, stop)
        if kind:
            return _outcome(kind, profit, ms), state
        for pos in opened:
            if int(pos["exit"]) <= ms:
                realized += float(pos["net"])
                pos["done"] = True
                pos["open"] = False
        still = [pos for pos in state if pos["open"] and not pos["done"]]
        profit = _mark(realized, still)
        kind = _cross(profit, take_profit, stop)
        if kind:
            return _outcome(kind, profit, ms), state
    return _outcome("none", realized, None), state


def _mark(realized: float, opened: list[dict[str, Any]]) -> float:
    floating = sum(float(pos["gross"]) - float(pos["commission"]) for pos in opened)
    return round(realized + floating, 2)


def _cross(profit: float, take_profit: float, stop: float) -> str | None:
    # A tick has one profit. The stop is checked first so a loss exits as a stop.
    if profit <= -stop:
        return "sl"
    if profit >= take_profit:
        return "tp"
    return None


def _outcome(kind: str, profit: float, ms: int | None) -> dict[str, Any]:
    return {"hit": kind, "profit": round(profit, 2), "ms": ms}


def _drop_trade(trade: dict[str, Any]) -> None:
    trade["status"] = "skipped"
    trade["net_pnl_usd"] = None
    trade["sim_pnl_usd"] = None
    trade["pnl"] = None
    trade["exit_reason"] = "account_flat"


def _trim_path(path: list[dict[str, Any]], hit_ms: int, gross: float) -> list[dict[str, Any]]:
    kept = []
    for point in path:
        ms = _ms(point.get("t"))
        if ms is None or ms <= hit_ms:
            kept.append(point)
    stamp = _fmt_ms(hit_ms)
    if not kept or _ms(kept[-1].get("t")) != hit_ms:
        kept.append({"t": stamp, "equity": round(gross, 2), "drawdown": 0.0})
    else:
        kept[-1] = {**kept[-1], "equity": round(gross, 2)}
    return kept


def _rebuild_equity(result: dict[str, Any]) -> None:
    balance = float((result.get("settings") or {}).get("starting_balance") or 0.0)
    closed = [
        trade
        for trade in result.get("trades") or []
        if trade.get("status") == "ok" and trade.get("net_pnl_usd") is not None and trade.get("fill_exit_time")
    ]
    closed.sort(key=lambda trade: _ms(trade.get("fill_exit_time")) or 0)
    equity = balance
    peak = balance
    points: list[dict[str, Any]] = []
    for trade in closed:
        equity = round(equity + float(trade["net_pnl_usd"]), 2)
        peak = max(peak, equity)
        points.append(
            {
                "t": trade["fill_exit_time"],
                "equity": equity,
                "drawdown": round(peak - equity, 2),
                "exit_reason": trade.get("exit_reason"),
            }
        )
    result["equity"] = points


def _ms(value: Any) -> int | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int(parsed.timestamp() * 1000)
