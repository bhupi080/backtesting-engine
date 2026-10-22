from app import account_targets, vip_sim


def _line() -> dict:
    return {
        "id": "line-1",
        "symbol": "USDJPY",
        "strategy_id": "T",
        "lots": 0.1,
        "commission_per_lot": 7,
        "chart_tf_minutes": 0,
        "exit_mode": "csv",
    }


def _trade(
    trade_id: int,
    *,
    entry: str,
    exit_: str,
    net: float,
    gross: float | None = None,
    commission: float = 0.0,
) -> dict:
    return {
        "trade_id": trade_id,
        "status": "ok",
        "side": "long",
        "symbol": "USDJPY",
        "strategy_id": "T",
        "net_pnl_usd": net,
        "sim_pnl_usd": net if gross is None else gross,
        "tv_pnl_usd": net,
        "commission_usd": commission,
        "fill_entry_time": entry,
        "fill_exit_time": exit_,
        "exit_reason": "signal",
    }


def _book(trades: list[dict], paths: dict[str, list[dict]]) -> dict:
    return {
        "settings": {"starting_balance": 2000},
        "equity": [{"t": "2024-06-01T12:00:00+00:00", "equity": 2000, "drawdown": 0}],
        "trades": trades,
        "trade_equity": paths,
        "summary": {"analytics": {"session_pnls": {"sydney_tokyo": 0.0, "london_newyork": 0.0}}},
    }


def _path(points: list[tuple[str, float]]) -> list[dict]:
    return [{"t": stamp, "equity": gross, "drawdown": 0.0} for stamp, gross in points]


def test_dollar_steps_are_inclusive() -> None:
    assert account_targets.dollar_steps(500, 1000, 100) == [500, 600, 700, 800, 900, 1000]
    assert account_targets.dollar_steps(100, 400, 100) == [100, 200, 300, 400]


def test_unchecked_run_keeps_the_original_result(monkeypatch) -> None:
    equity = [{"t": "2024-06-01T12:00:00+00:00", "equity": 2040, "drawdown": 0, "exit_reason": "signal"}]
    trade = _trade(1, entry="2024-06-01T10:00:00+00:00", exit_="2024-06-01T12:00:00+00:00", net=40)

    def fake(_line, _chart_tf, **_kwargs):
        return _book([trade], {"1": _path([("2024-06-01T12:00:00+00:00", 40)])}) | {"equity": equity}, None

    monkeypatch.setattr(vip_sim, "_simulate_line", fake)
    result = vip_sim.run_vip(
        {
            "id": "vip",
            "name": "VIP",
            "starting_balance": 2000,
            "account_targets_enabled": False,
            "account_tp_usd": 10,
            "account_sl_usd": 10,
            "lines": [_line()],
        },
        analysis_tz="UTC",
    )
    assert result["account_target"] is None
    assert result["signal"]["summary"]["sim_pnl_usd"] == 40
    assert trade["status"] == "ok"
    assert trade["net_pnl_usd"] == 40
    assert trade["exit_reason"] == "signal"


def test_enabled_without_amounts_does_not_simulate(monkeypatch) -> None:
    def fake(*_args, **_kwargs):
        raise AssertionError("simulated")

    monkeypatch.setattr(vip_sim, "_simulate_line", fake)
    try:
        vip_sim.run_vip(
            {
                "id": "vip",
                "name": "VIP",
                "starting_balance": 2000,
                "account_targets_enabled": True,
                "lines": [_line()],
            },
            analysis_tz="UTC",
        )
    except ValueError as exc:
        assert "greater than zero" in str(exc)
    else:
        raise AssertionError("expected a validation error")


def test_no_hit_leaves_the_book_untouched() -> None:
    book = _book(
        [_trade(1, entry="2024-06-01T10:00:00+00:00", exit_="2024-06-01T12:00:00+00:00", net=40)],
        {"1": _path([("2024-06-01T10:00:00+00:00", 0), ("2024-06-01T12:00:00+00:00", 40)])},
    )
    equity = book["equity"]
    outcome = account_targets.apply_account_targets([book], 1000, 500)
    assert outcome == {"hit": "none", "profit": 40}
    assert book["equity"] is equity
    assert book["trades"][0]["exit_reason"] == "signal"


def test_overshoot_stamps_the_crossing_profit_and_skips_later_trades() -> None:
    early = "2024-06-01T10:00:00+00:00"
    cross = "2024-06-01T11:00:00+00:00"
    natural = "2024-06-01T15:00:00+00:00"
    later_entry = "2024-06-01T12:00:00+00:00"
    later_exit = "2024-06-01T16:00:00+00:00"
    held = _trade(1, entry=early, exit_=natural, net=200)
    later = _trade(2, entry=later_entry, exit_=later_exit, net=80)
    book = _book(
        [held, later],
        {
            "1": _path([(early, 0), (cross, 1047), (natural, 200)]),
            "2": _path([(later_entry, 0), (later_exit, 80)]),
        },
    )
    outcome = account_targets.apply_account_targets([book], 1000, 500)
    assert outcome == {"hit": "tp", "profit": 1047}
    assert held["net_pnl_usd"] == 1047
    assert held["exit_reason"] == "account_tp"
    assert later["status"] == "skipped"
    assert later["net_pnl_usd"] is None
    combined = vip_sim.combine_books([book], name="VIP", analysis_tz="UTC", starting_balance=2000)
    assert combined["summary"]["sim_pnl_usd"] == 1047
    assert combined["summary"]["filled"] == 1


def test_a_loss_through_the_stop_wins_over_take_profit() -> None:
    entry = "2024-06-01T10:00:00+00:00"
    jump = "2024-06-01T11:00:00+00:00"
    book = _book(
        [_trade(1, entry=entry, exit_="2024-06-01T15:00:00+00:00", net=-20)],
        {"1": _path([(entry, 0), (jump, -620)])},
    )
    outcome = account_targets.apply_account_targets([book], 1000, 500)
    assert outcome == {"hit": "sl", "profit": -620}


def test_open_commission_is_part_of_the_account_profit() -> None:
    entry = "2024-06-01T10:00:00+00:00"
    mark = "2024-06-01T11:00:00+00:00"
    book = _book(
        [_trade(1, entry=entry, exit_="2024-06-01T15:00:00+00:00", net=93, gross=100, commission=7)],
        {"1": _path([(entry, 0), (mark, 100)])},
    )
    outcome = account_targets.scan_account_target([book], 90, 500)
    assert outcome == {"hit": "tp", "profit": 93}


def test_open_trades_are_marked_together() -> None:
    first = _trade(1, entry="2024-06-01T10:00:00+00:00", exit_="2024-06-01T14:00:00+00:00", net=100)
    second = _trade(2, entry="2024-06-01T11:00:00+00:00", exit_="2024-06-01T15:00:00+00:00", net=80)
    book = _book(
        [first, second],
        {
            "1": _path([("2024-06-01T10:00:00+00:00", 0), ("2024-06-01T11:00:00+00:00", 100)]),
            "2": _path([("2024-06-01T11:00:00+00:00", 50)]),
        },
    )
    outcome = account_targets.scan_account_target([book], 140, 500)
    assert outcome == {"hit": "tp", "profit": 150}


def test_checked_run_judges_each_fill_on_its_own_book(monkeypatch) -> None:
    def fake(_line, chart_tf, **_kwargs):
        if chart_tf == 0:
            trade = _trade(1, entry="2024-06-01T10:00:00+00:00", exit_="2024-06-01T15:00:00+00:00", net=200)
            return _book(
                [trade],
                {"1": _path([("2024-06-01T10:00:00+00:00", 0), ("2024-06-01T11:00:00+00:00", 1047)])},
            ), None
        trade = _trade(1, entry="2024-06-01T10:00:00+00:00", exit_="2024-06-01T12:00:00+00:00", net=20)
        return _book(
            [trade],
            {"1": _path([("2024-06-01T10:00:00+00:00", 0), ("2024-06-01T12:00:00+00:00", 20)])},
        ), None

    monkeypatch.setattr(vip_sim, "_simulate_line", fake)
    line = _line()
    line["chart_tf_minutes"] = 10
    result = vip_sim.run_vip(
        {
            "id": "vip",
            "name": "VIP",
            "starting_balance": 2000,
            "account_targets_enabled": True,
            "account_tp_usd": 1000,
            "account_sl_usd": 500,
            "lines": [line],
        },
        analysis_tz="UTC",
    )
    assert result["account_target"]["signal"] == {"hit": "tp", "profit": 1047.0}
    assert result["account_target"]["bar_close"] == {"hit": "none", "profit": 20.0}
    assert result["signal"]["summary"]["sim_pnl_usd"] == 1047
    assert result["bar_close"]["summary"]["sim_pnl_usd"] == 20


def test_grid_stamps_overshoot_stop_and_ending_profit() -> None:
    entry = "2024-06-01T10:00:00+00:00"
    mark = "2024-06-01T11:00:00+00:00"
    exit_ = "2024-06-01T12:00:00+00:00"
    book = _book(
        [_trade(1, entry=entry, exit_=exit_, net=120)],
        {"1": _path([(entry, 0), (mark, 1047), (exit_, 120)])},
    )
    grid = account_targets.target_grid([book], [1000, 2000], [500])
    assert grid[0][0] == {"hit": "tp", "profit": 1047}
    assert grid[1][0] == {"hit": "none", "profit": 120}

    stopped = _book(
        [_trade(1, entry=entry, exit_=exit_, net=-20)],
        {"1": _path([(entry, 0), (mark, -180), (exit_, -20)])},
    )
    loss = account_targets.target_grid([stopped], [1000], [100])
    assert loss[0][0] == {"hit": "sl", "profit": -180}
