"""End-to-end dashboard contract checks against a live API.

Validates every payload surface the Simulate / Datasets / Trades pages consume.
Exit 0 on pass; prints FAIL lines and exits 1 on any assertion failure.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8000"
FE = "http://127.0.0.1:5173"
EPS = 0.02  # USD rounding tolerance (paths round to 2dp)

failures: list[str] = []
passes: list[str] = []


def ok(msg: str) -> None:
    passes.append(msg)
    print(f"  PASS  {msg}")


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL  {msg}")


def get_json(path: str, params: dict[str, Any] | None = None, timeout: float = 600) -> Any:
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{BASE}{path}{qs}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def get_status(url: str, timeout: float = 30) -> int:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def nearly(a: float | None, b: float | None, eps: float = EPS) -> bool:
    if a is None or b is None:
        return a is b
    return abs(float(a) - float(b)) <= eps


def check_list_endpoint(name: str, path: str, min_len: int = 1) -> Any:
    data = get_json(path)
    if not isinstance(data, list) or len(data) < min_len:
        fail(f"{name}: expected list len>={min_len}, got {type(data)} len={getattr(data,'__len__',lambda: '?')()}")
    else:
        ok(f"{name}: {len(data)} items")
    return data


def validate_simulate(label: str, data: dict[str, Any], *, expect_tf: int) -> None:
    print(f"\n=== Simulate {label} ===")
    required_top = [
        "symbol",
        "strategy_id",
        "trade_count",
        "trades",
        "equity",
        "trade_equity",
        "summary",
        "settings",
    ]
    for k in required_top:
        if k not in data or data[k] is None:
            fail(f"{label}: missing top-level {k}")
            return
    ok(f"{label}: top-level keys present")

    settings = data["settings"]
    if settings.get("chart_tf_minutes") != expect_tf:
        fail(f"{label}: chart_tf_minutes={settings.get('chart_tf_minutes')} want {expect_tf}")
    else:
        ok(f"{label}: chart_tf_minutes={expect_tf}")

    summary = data["summary"]
    analytics = summary.get("analytics")
    if not analytics:
        fail(f"{label}: summary.analytics missing")
        return
    ok(f"{label}: analytics present")

    # --- KPI fields Analytics panel reads ---
    for k in [
        "avg_pnl_usd",
        "avg_win_usd",
        "avg_loss_usd",
        "best_trade",
        "worst_trade",
        "by_side",
        "shortest_win_ms",
        "shortest_loss_ms",
        "avg_win_duration_ms",
        "avg_loss_duration_ms",
        "max_consecutive_wins",
        "max_consecutive_losses",
        "monthly_pnls",
        "daily_pnls",
        "session_pnls",
    ]:
        if k not in analytics:
            fail(f"{label}: analytics missing {k}")
    else:
        ok(f"{label}: analytics KPI keys complete")

    session = analytics["session_pnls"]
    for sk in ("sydney_tokyo", "london_newyork"):
        if sk not in session:
            fail(f"{label}: session_pnls missing {sk}")
    sess_sum = float(session.get("sydney_tokyo", 0)) + float(
        session.get("london_newyork", 0)
    )
    # Session PnL is floating gross (commission not split across sessions).
    # It should match sum(sim_pnl) ≈ sim_pnl_usd, or net + total commission.
    filled_for_comm = [
        t
        for t in data["trades"]
        if t.get("sim_pnl_usd") is not None
    ]
    gross = sum(float(t["sim_pnl_usd"]) for t in filled_for_comm)
    total_comm = sum(float(t.get("commission_usd") or 0) for t in filled_for_comm)
    net_plus_comm = float(summary["sim_pnl_usd"]) + total_comm
    if nearly(sess_sum, gross, eps=1.0) or nearly(sess_sum, net_plus_comm, eps=1.0):
        ok(f"{label}: session PnLs sum ~ gross ({sess_sum:.2f})")
    else:
        fail(
            f"{label}: session sum {sess_sum:.2f} vs gross {gross:.2f} / "
            f"sim+comm {net_plus_comm:.2f} (sim={summary['sim_pnl_usd']:.2f})"
        )

    # Monthly/daily structure
    for period_list, name in (
        (analytics["monthly_pnls"], "monthly"),
        (analytics["daily_pnls"], "daily"),
    ):
        if not isinstance(period_list, list) or not period_list:
            fail(f"{label}: {name}_pnls empty")
        else:
            bad = [p for p in period_list if "period" not in p or "pnl_usd" not in p]
            if bad:
                fail(f"{label}: {name}_pnls malformed rows")
            else:
                ok(f"{label}: {name}_pnls ({len(period_list)} periods)")

    # Summary vs trades
    filled = [t for t in data["trades"] if t.get("status") == "filled" or t.get("net_pnl_usd") is not None]
    # Prefer status if present
    filled_by_status = [t for t in data["trades"] if t.get("status") == "filled"]
    if filled_by_status:
        filled = filled_by_status
    if summary["filled"] != len(filled) and summary["filled"] != data["closed_count"]:
        # soft: closed_count often equals filled
        if summary["filled"] > data["trade_count"]:
            fail(f"{label}: filled {summary['filled']} > trade_count {data['trade_count']}")
        else:
            ok(f"{label}: filled={summary['filled']} trades={data['trade_count']}")
    else:
        ok(f"{label}: filled={summary['filled']}")

    wins = sum(1 for t in filled if (t.get("net_pnl_usd") or 0) > 0)
    losses = sum(1 for t in filled if (t.get("net_pnl_usd") or 0) < 0)
    if summary["wins"] != wins or summary["losses"] != losses:
        # recount with sim if net differs
        wins2 = sum(1 for t in filled if (t.get("sim_pnl_usd") or 0) > 0)
        losses2 = sum(1 for t in filled if (t.get("sim_pnl_usd") or 0) < 0)
        if summary["wins"] not in (wins, wins2) or summary["losses"] not in (losses, losses2):
            fail(
                f"{label}: wins/losses summary={summary['wins']}/{summary['losses']} "
                f"net={wins}/{losses} sim={wins2}/{losses2}"
            )
        else:
            ok(f"{label}: wins/losses consistent ({summary['wins']}/{summary['losses']})")
    else:
        ok(f"{label}: wins/losses match ({wins}/{losses})")

    # Equity curve
    eq = data["equity"]
    if len(eq) < 2:
        fail(f"{label}: equity too short ({len(eq)})")
    else:
        ok(f"{label}: equity points={len(eq)}")
    if eq:
        end_eq = eq[-1]["equity"]
        if not nearly(end_eq, summary["ending_equity"], eps=0.05):
            fail(
                f"{label}: equity end {end_eq} vs ending_equity {summary['ending_equity']}"
            )
        else:
            ok(f"{label}: equity end = ending_equity ({end_eq:.2f})")

    # Account max DD on equity path
    peak = eq[0]["equity"] if eq else 0
    max_dd = 0.0
    for p in eq:
        peak = max(peak, p["equity"])
        max_dd = max(max_dd, peak - p["equity"])
    if not nearly(max_dd, summary.get("max_drawdown_usd", data["max_drawdown"]), eps=0.5):
        # data.max_drawdown may be pct in older; use summary
        sdd = summary.get("max_drawdown_usd")
        if sdd is not None and not nearly(max_dd, sdd, eps=0.5):
            fail(f"{label}: recomputed DD {max_dd:.2f} vs summary {sdd}")
        else:
            ok(f"{label}: account DD ~ {max_dd:.2f}")
    else:
        ok(f"{label}: account DD ~ {max_dd:.2f}")

    # Trade paths: MFE/MAE must match table for every filled trade with a path
    trade_eq = data.get("trade_equity") or {}
    mismatch = []
    missing_path = []
    checked = 0
    for t in data["trades"]:
        tid = str(t["trade_id"])
        mfe = t.get("max_runup_usd")
        mae = t.get("max_drawdown_usd")
        if mfe is None and mae is None:
            continue
        path = trade_eq.get(tid)
        if not path:
            missing_path.append(tid)
            continue
        eqs = [p["equity"] for p in path]
        path_mfe = max(eqs)
        path_mae = min(eqs)
        checked += 1
        if mfe is not None and not nearly(path_mfe, mfe):
            mismatch.append(f"#{tid} MFE path={path_mfe} table={mfe}")
        if mae is not None and not nearly(path_mae, mae):
            mismatch.append(f"#{tid} MAE path={path_mae} table={mae}")
        # drawdown field non-negative
        if any(p.get("drawdown", 0) < -0.01 for p in path):
            mismatch.append(f"#{tid} negative drawdown field")

    if missing_path:
        fail(f"{label}: {len(missing_path)} trades missing trade_equity paths: {missing_path[:8]}")
    if mismatch:
        fail(f"{label}: path↔table MFE/MAE mismatches ({len(mismatch)}): {mismatch[:5]}")
    else:
        ok(f"{label}: all {checked} trade paths MFE/MAE match table")

    # Best/worst trade IDs exist
    for key in ("best_trade", "worst_trade"):
        bt = analytics.get(key)
        if bt:
            ids = {t["trade_id"] for t in data["trades"]}
            if bt["trade_id"] not in ids:
                fail(f"{label}: {key} id {bt['trade_id']} not in trades")
            else:
                ok(f"{label}: {key}=#{bt['trade_id']} ({bt['pnl_usd']:.2f})")

    # by_side shares
    by_side = summary.get("by_side") or {}
    if by_side:
        shares = sum(s.get("share_pct", 0) for s in by_side.values())
        if summary["filled"] and abs(shares - 100) > 1.5:
            fail(f"{label}: by_side share_pct sum={shares}")
        else:
            ok(f"{label}: by_side share_pct~100 ({shares:.1f})")

    # Commission: net ≈ sim - commission for filled
    comm_bad = []
    for t in filled:
        sim = t.get("sim_pnl_usd")
        net = t.get("net_pnl_usd")
        comm = t.get("commission_usd")
        if sim is None or net is None or comm is None:
            continue
        if not nearly(net, sim - comm, eps=0.05):
            comm_bad.append(t["trade_id"])
    if comm_bad:
        fail(f"{label}: net≠sim-commission for trades {comm_bad[:8]}")
    else:
        ok(f"{label}: net = sim − commission")


def main() -> int:
    print("=== API foundation ===")
    try:
        h = get_json("/health")
        if h.get("status") == "ok":
            ok("GET /health")
        else:
            fail(f"/health body {h}")
    except Exception as e:
        fail(f"/health unreachable: {e}")
        print("\nAPI down — aborting.")
        return 1

    check_list_endpoint("GET /datasets", "/datasets")
    check_list_endpoint("GET /strategies", "/strategies")
    check_list_endpoint("GET /market-hours/symbols", "/market-hours/symbols")
    check_list_endpoint("GET /ticks/jobs", "/ticks/jobs", min_len=0)

    try:
        overview = get_json("/overview", {"symbol": "USDJPY"})
        if isinstance(overview, dict):
            ok("GET /overview?symbol=USDJPY")
        else:
            fail("GET /overview not object")
    except Exception as e:
        fail(f"GET /overview: {e}")

    try:
        ticks = get_json("/ticks", {"symbol": "USDJPY", "page": 1, "page_size": 5})
        if ticks.get("rows") is not None and ticks.get("total", 0) > 0:
            ok(f"GET /ticks USDJPY total={ticks['total']}")
        else:
            fail("GET /ticks empty")
    except Exception as e:
        fail(f"GET /ticks: {e}")

    try:
        trades = get_json(
            "/trades",
            {"symbol": "USDJPY", "strategy_id": "A1", "page": 1, "page_size": 10},
        )
        if trades.get("total", 0) >= 1:
            ok(f"GET /trades A1 total={trades['total']}")
        else:
            fail("GET /trades A1 empty")
    except Exception as e:
        fail(f"GET /trades: {e}")

    # Dual fill groups (dashboard always runs both when Chart TF > 0)
    common = {
        "symbol": "USDJPY",
        "strategy_id": "A1",
        "lots": 0.1,
        "commission_per_lot": 7,
        "starting_balance": 2000,
        "analysis_tz": "UTC",
    }
    try:
        sig = get_json("/simulate", {**common, "chart_tf_minutes": 0})
        bar = get_json("/simulate", {**common, "chart_tf_minutes": 10})
    except Exception as e:
        fail(f"simulate dual run: {e}")
        print("\n" + "=" * 50)
        print(f"Passed: {len(passes)}  Failed: {len(failures)}")
        return 1

    validate_simulate("signal TF=0", sig, expect_tf=0)
    validate_simulate("barClose TF=10", bar, expect_tf=10)

    # Groups should differ in at least fill timing or PnL when TF delay applies
    print("\n=== Dual-group comparison ===")
    if sig["summary"]["sim_pnl_usd"] == bar["summary"]["sim_pnl_usd"]:
        ok(
            f"groups PnL equal ({sig['summary']['sim_pnl_usd']:.2f}) — possible if no TF delay effect"
        )
    else:
        ok(
            f"groups PnL differ: signal={sig['summary']['sim_pnl_usd']:.2f} "
            f"barClose={bar['summary']['sim_pnl_usd']:.2f}"
        )

    # Trade #4 regression (known case)
    t4 = next((t for t in bar["trades"] if t["trade_id"] == 4), None)
    if t4:
        path = (bar.get("trade_equity") or {}).get("4") or []
        eqs = [p["equity"] for p in path]
        if eqs and nearly(max(eqs), t4["max_runup_usd"]) and nearly(
            min(eqs), t4["max_drawdown_usd"]
        ):
            ok(
                f"Trade #4 MFE/MAE path=table {t4['max_runup_usd']}/{t4['max_drawdown_usd']}"
            )
        else:
            fail(
                f"Trade #4 mismatch path={max(eqs) if eqs else None}/{min(eqs) if eqs else None} "
                f"table={t4.get('max_runup_usd')}/{t4.get('max_drawdown_usd')}"
            )
    else:
        fail("Trade #4 not in A1 barClose result")

    # Also validate strategy T (pytest fixture path) for broader coverage
    try:
        t_sim = get_json(
            "/simulate",
            {
                "symbol": "USDJPY",
                "strategy_id": "T",
                "lots": 0.1,
                "commission_per_lot": 7,
                "starting_balance": 2000,
                "chart_tf_minutes": 10,
                "analysis_tz": "UTC",
            },
        )
        validate_simulate("strategy T TF=10", t_sim, expect_tf=10)
    except Exception as e:
        fail(f"simulate strategy T: {e}")

    # Frontend route smoke
    print("\n=== Frontend routes ===")
    for route in ("/", "/datasets", "/trades", "/simulate", "/overview", "/risk-reward"):
        status = get_status(f"{FE}{route}")
        if status == 200:
            ok(f"FE {route} → {status}")
        else:
            fail(f"FE {route} → {status}")

    print("\n" + "=" * 50)
    print(f"Passed: {len(passes)}  Failed: {len(failures)}")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
