from app.risk_reward import atr_asof, level_prices, wilder_atr


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


def test_level_prices() -> None:
    tp, sl = level_prices("long", 150.0, 0.2, 2.0, 1.0)
    assert tp == 150.4
    assert sl == 149.8
    tp_s, sl_s = level_prices("short", 150.0, 0.2, 2.0, 1.0)
    assert tp_s == 149.6
    assert sl_s == 150.2
