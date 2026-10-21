import pytest

from app.risk_reward import (
    atr_asof,
    first_exit_price,
    level_prices,
    multiplier_range,
    wilder_atr,
)


def test_wilder_atr_sma_then_smooth() -> None:
    bars = [
        (0, 10.0, 8.0, 9.0),
        (1, 11.0, 9.0, 10.0),
        (2, 12.0, 10.0, 11.0),
        (3, 14.0, 10.0, 13.0),
    ]
    atrs = wilder_atr(bars, 2)
    assert atrs[0] is None
    assert atrs[1] is None
    assert atrs[2] == 2.0
    assert atrs[3] == 3.0


def test_atr_asof_uses_last_closed_bar() -> None:
    bars = [
        (0, 1.0, 0.0, 1.0),
        (10, 2.0, 0.0, 1.0),
        (20, 3.0, 0.0, 2.0),
        (30, 4.0, 0.0, 3.0),
    ]
    atrs = [None, 1.0, 2.0, 9.0]
    # Bar at 20 closes at 30. Entry at 30 sees ATR 2, not the bar that just opened.
    assert atr_asof(bars, atrs, 30, 10) == 2.0
    assert atr_asof(bars, atrs, 29, 10) == 1.0


def test_multiplier_range_is_inclusive() -> None:
    assert multiplier_range(2, 3, 0.1) == [
        round(2 + i * 0.1, 10) for i in range(11)
    ]
    assert multiplier_range(3, 2, 0.1)[0] == 2


def test_multiplier_range_rejects_a_wide_span() -> None:
    with pytest.raises(ValueError):
        multiplier_range(1, 6, 0.1)


def test_first_exit_price_takes_the_first_level() -> None:
    events = [(2, 10.1), (3, 9.7), (4, 11.0)]
    price, reason = first_exit_price(events, "long", tp=10.4, sl=9.8, csv_price=10.2)
    assert reason == "sl"
    assert price == 9.7


def test_first_exit_price_uses_csv_when_neither_level_is_touched() -> None:
    events = [(2, 10.1), (3, 10.2)]
    price, reason = first_exit_price(events, "long", tp=10.5, sl=9.5, csv_price=10.25)
    assert reason == "signal"
    assert price == 10.25


def test_first_exit_price_stop_wins_when_one_tick_reaches_both() -> None:
    price, reason = first_exit_price([(2, 10.0)], "long", tp=10.0, sl=10.0, csv_price=9.0)
    assert reason == "sl"
    assert price == 10.0


def test_level_prices() -> None:
    tp, sl = level_prices("long", 150.0, 0.2, 2.0, 1.0)
    assert tp == 150.4
    assert sl == 149.8
    tp_s, sl_s = level_prices("short", 150.0, 0.2, 2.0, 1.0)
    assert tp_s == 149.6
    assert sl_s == 150.2
