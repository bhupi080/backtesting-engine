from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config import Settings, get_settings


@dataclass
class NormalizedTrade:
    trade_id: int
    symbol: str
    strategy_id: str
    side: str
    open_time: str | None
    open_price: float | None
    close_time: str | None
    close_price: float | None
    size: float
    tv_net_pnl: float | None
    tv_commission: float | None
    signal_entry: str | None
    signal_exit: str | None
    is_open: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "trade_id": self.trade_id,
            "symbol": self.symbol,
            "strategy_id": self.strategy_id,
            "side": self.side,
            "open_time": self.open_time,
            "open_price": self.open_price,
            "close_time": self.close_time,
            "close_price": self.close_price,
            "size": self.size,
            "tv_net_pnl": self.tv_net_pnl,
            "tv_commission": self.tv_commission,
            "signal_entry": self.signal_entry,
            "signal_exit": self.signal_exit,
            "is_open": self.is_open,
        }


def _parse_price(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw or raw in {"—", "-", "Open"}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _price_from_row(row: dict[str, Any]) -> float | None:
    """TV exports use Price JPY / Price USD / etc. — pick the Price* column."""
    if "Price JPY" in row:
        return _parse_price(row.get("Price JPY", ""))
    if "Price USD" in row:
        return _parse_price(row.get("Price USD", ""))
    for key, val in row.items():
        if key.lower().startswith("price"):
            return _parse_price(val)
    return None


def _parse_float(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_tv_time(raw: str, tz_name: str) -> str | None:
    raw = (raw or "").strip()
    if not raw or raw == "Open":
        return None
    tz = ZoneInfo(tz_name)
    # TradingView export: "2026-07-06 11:00"
    dt = datetime.strptime(raw, "%Y-%m-%d %H:%M").replace(tzinfo=tz)
    return dt.isoformat()


def _count_trades_in_csv(path: Path) -> int:
    """Count unique trade ids from Entry rows only (cheap catalog scan)."""
    ids: set[int] = set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            typ = row.get("Type") or ""
            if not typ.startswith("Entry"):
                continue
            try:
                ids.add(int(row["Trade number"]))
            except (KeyError, TypeError, ValueError):
                continue
    return len(ids)


def discover_strategies(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Catalog strategies from disk. Uses latest CSV only for trade_count."""
    settings = settings or get_settings()
    root = settings.trades_dir
    if not root.exists():
        return []
    out: list[dict[str, Any]] = []
    for symbol_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for strat_dir in sorted(p for p in symbol_dir.iterdir() if p.is_dir()):
            files = sorted(strat_dir.glob("*.csv"))
            latest = files[-1] if files else None
            out.append(
                {
                    "symbol": symbol_dir.name,
                    "strategy_id": strat_dir.name,
                    "trade_files": [f.name for f in files],
                    "csv_count": len(files),
                    "latest_file": latest.name if latest else None,
                    "trade_count": _count_trades_in_csv(latest) if latest else 0,
                }
            )
    return out


def _csv_paths(symbol: str, strategy_id: str, settings: Settings) -> list[Path]:
    d = settings.trades_dir / symbol / strategy_id
    if not d.exists():
        return []
    return sorted(d.glob("*.csv"))


def load_trades(
    symbol: str,
    strategy_id: str,
    settings: Settings | None = None,
) -> list[NormalizedTrade]:
    settings = settings or get_settings()
    paths = _csv_paths(symbol, strategy_id, settings)
    if not paths:
        return []
    # Prefer latest export by name (date suffix)
    path = paths[-1]
    by_id: dict[int, dict[str, Any]] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tid = int(row["Trade number"])
            slot = by_id.setdefault(tid, {"entry": None, "exit": None})
            typ = row["Type"]
            if typ.startswith("Entry"):
                slot["entry"] = row
            elif typ.startswith("Exit"):
                slot["exit"] = row

    trades: list[NormalizedTrade] = []
    for tid in sorted(by_id):
        entry = by_id[tid]["entry"]
        exit_ = by_id[tid]["exit"]
        if entry is None and exit_ is None:
            continue
        side = "long"
        if entry and "short" in entry["Type"].lower():
            side = "short"
        elif exit_ and "short" in exit_["Type"].lower():
            side = "short"

        src = entry or exit_
        is_open = bool(
            exit_
            and (
                (exit_.get("Date and time") or "") == "Open"
                or (exit_.get("Signal") or "") == "Open"
            )
        )
        trades.append(
            NormalizedTrade(
                trade_id=tid,
                symbol=symbol,
                strategy_id=strategy_id,
                side=side,
                open_time=_parse_tv_time(
                    (entry or {}).get("Date and time", ""), settings.tv_trades_tz
                )
                if entry
                else None,
                open_price=_price_from_row(entry) if entry else None,
                close_time=None
                if is_open
                else _parse_tv_time(
                    (exit_ or {}).get("Date and time", ""), settings.tv_trades_tz
                ),
                close_price=None if is_open else (_price_from_row(exit_) if exit_ else None),
                size=float((src or {}).get("Size (qty)") or 0),
                tv_net_pnl=_parse_float((src or {}).get("Net PnL USD", "")),
                tv_commission=_parse_float((src or {}).get("Commission USD", "")),
                signal_entry=(entry or {}).get("Signal"),
                signal_exit=None if is_open else (exit_ or {}).get("Signal"),
                is_open=is_open,
            )
        )
    return trades


def list_trades_page(
    symbol: str,
    strategy_id: str,
    page: int = 1,
    page_size: int = 50,
    sort: str = "trade_id",
    order: str = "asc",
    settings: Settings | None = None,
) -> dict[str, Any]:
    trades = load_trades(symbol, strategy_id, settings=settings)
    reverse = order.lower() == "desc"
    key_map = {
        "trade_id": lambda t: t.trade_id,
        "open_time": lambda t: t.open_time or "",
        "close_time": lambda t: t.close_time or "",
        "tv_net_pnl": lambda t: t.tv_net_pnl if t.tv_net_pnl is not None else float("-inf"),
        "size": lambda t: t.size,
    }
    key = key_map.get(sort, key_map["trade_id"])
    trades = sorted(trades, key=key, reverse=reverse)
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    start = (page - 1) * page_size
    chunk = trades[start : start + page_size]
    return {
        "total": len(trades),
        "page": page,
        "page_size": page_size,
        "rows": [t.as_dict() for t in chunk],
    }


def simulate(
    symbol: str,
    strategy_id: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """PnL from trade open/close prices (FX: USDJPY PnL ≈ (close-open)*size/close for long)."""
    trades = load_trades(symbol, strategy_id, settings=settings)

    def in_range(t: NormalizedTrade) -> bool:
        if from_ts and t.open_time and t.open_time < from_ts:
            return False
        if to_ts and t.open_time and t.open_time > to_ts:
            return False
        return True

    trades = [t for t in trades if in_range(t)]
    results: list[dict[str, Any]] = []
    equity_pts: list[dict[str, Any]] = []
    cum = 0.0
    peak = 0.0
    max_dd = 0.0
    closed = 0

    for t in trades:
        pnl: float | None = None
        if (
            not t.is_open
            and t.open_price is not None
            and t.close_price is not None
            and t.close_price != 0
        ):
            diff = t.close_price - t.open_price
            if t.side == "short":
                diff = -diff
            # USDJPY-style (quote JPY): convert to USD. USD-quoted (XAUUSD etc.): linear.
            if symbol.endswith("JPY"):
                pnl = (diff * t.size) / t.close_price
            else:
                pnl = diff * t.size
            if t.tv_commission:
                pnl -= t.tv_commission
            closed += 1
            cum += pnl
            peak = max(peak, cum)
            dd = peak - cum
            max_dd = max(max_dd, dd)
            t_label = t.close_time or t.open_time or ""
            equity_pts.append({"t": t_label, "equity": cum, "drawdown": dd})

        results.append(
            {
                "trade_id": t.trade_id,
                "side": t.side,
                "open_time": t.open_time,
                "close_time": t.close_time,
                "open_price": t.open_price,
                "close_price": t.close_price,
                "size": t.size,
                "pnl": pnl,
                "tv_net_pnl": t.tv_net_pnl,
                "cumulative_pnl": cum,
            }
        )

    return {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "trade_count": len(trades),
        "closed_count": closed,
        "total_pnl": cum,
        "max_drawdown": max_dd,
        "trades": results,
        "equity": equity_pts,
    }
