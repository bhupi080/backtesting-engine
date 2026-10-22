from datetime import datetime

from app import vip_store
from app.vip_sim import combine_books, validate_lines


def _book(balance: float, points: list[dict], trades: list[dict] | None = None) -> dict:
    return {
        "settings": {"starting_balance": balance},
        "equity": points,
        "trades": trades or [],
        "trade_equity": {},
        "summary": {"analytics": {"session_pnls": {"sydney_tokyo": 1.0, "london_newyork": 2.0}}},
    }


def test_combine_adds_overlapping_pnl() -> None:
    combined = combine_books(
        [
            _book(
                1000,
                [
                    {"t": "2024-01-01T00:00:00+00:00", "equity": 1000},
                    {"t": "2024-01-01T01:00:00+00:00", "equity": 1100, "exit_reason": "tp"},
                ],
            ),
            _book(
                500,
                [
                    {"t": "2024-01-01T00:30:00+00:00", "equity": 500},
                    {"t": "2024-01-01T01:00:00+00:00", "equity": 450, "exit_reason": "sl"},
                ],
            ),
        ],
        name="vip-1",
        analysis_tz="UTC",
    )
    by_time = {datetime.fromisoformat(p["t"]): p["equity"] for p in combined["equity"]}
    assert by_time[datetime.fromisoformat("2024-01-01T00:30:00+00:00")] == 1500
    assert by_time[datetime.fromisoformat("2024-01-01T01:00:00+00:00")] == 1550
    assert combined["equity"][-1]["exit_reason"] is None
    assert combined["summary"]["analytics"]["session_pnls"] == {
        "sydney_tokyo": 2.0,
        "london_newyork": 4.0,
    }
    assert combined["settings"]["starting_balance"] == 1500


def test_combine_orders_trades_by_exit() -> None:
    combined = combine_books(
        [
            _book(
                1000,
                [],
                [
                    {
                        "trade_id": 7,
                        "status": "ok",
                        "side": "long",
                        "net_pnl_usd": 10,
                        "sim_pnl_usd": 12,
                        "tv_pnl_usd": 9,
                        "fill_exit_time": "2024-01-02T00:00:00+00:00",
                        "fill_entry_time": "2024-01-01T00:00:00+00:00",
                        "symbol": "USDJPY",
                        "strategy_id": "T",
                    }
                ],
            ),
            _book(
                1000,
                [],
                [
                    {
                        "trade_id": 7,
                        "status": "ok",
                        "side": "short",
                        "net_pnl_usd": -4,
                        "sim_pnl_usd": -2,
                        "tv_pnl_usd": -1,
                        "fill_exit_time": "2024-01-01T12:00:00+00:00",
                        "fill_entry_time": "2024-01-01T00:00:00+00:00",
                        "symbol": "NZDJPY",
                        "strategy_id": "A",
                    }
                ],
            ),
        ],
        name="vip-1",
        analysis_tz="UTC",
    )
    trades = combined["trades"]
    assert [t["symbol"] for t in trades] == ["NZDJPY", "USDJPY"]
    assert trades[0]["trade_id"] == 1
    assert trades[1]["cumulative_pnl"] == 6
    assert combined["summary"]["sim_pnl_usd"] == 6


def test_vip_json_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(vip_store, "vip_path", lambda: tmp_path / "vips.json")
    created = vip_store.create_vip("vip-1")
    line = {
        "id": "line-1",
        "symbol": "USDJPY",
        "strategy_id": "T",
        "atr_bar_minutes": 60,
        "atr_period": 14,
        "tp_atr_mult": 3.6,
        "sl_atr_mult": 1.9,
        "lots": 0.1,
        "commission_per_lot": 7,
        "starting_balance": 2000,
        "chart_tf_minutes": 0,
    }
    validate_lines([line])
    saved = vip_store.update_vip(created["id"], lines=[line])
    assert saved is not None
    again = vip_store.get_vip(created["id"])
    assert again is not None
    assert again["lines"][0]["tp_atr_mult"] == 3.6
    assert vip_store.delete_vip(created["id"]) is True
    assert vip_store.get_vip(created["id"]) is None
