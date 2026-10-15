from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_datasets() -> None:
    r = client.get("/datasets")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(d["symbol"] == "USDJPY" for d in data)


def test_ticks_paginated() -> None:
    r = client.get(
        "/ticks",
        params={"symbol": "USDJPY", "page": 1, "page_size": 10},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["page_size"] == 10
    assert len(body["rows"]) <= 10
    assert body["total"] > 0


def test_strategies_and_trades() -> None:
    r = client.get("/strategies")
    assert r.status_code == 200
    strats = r.json()
    assert any(s["symbol"] == "USDJPY" and s["strategy_id"] == "T" for s in strats)
    r2 = client.get(
        "/trades",
        params={"symbol": "USDJPY", "strategy_id": "T", "page_size": 20},
    )
    assert r2.status_code == 200
    assert r2.json()["total"] >= 1


def test_simulate() -> None:
    r = client.get(
        "/simulate",
        params={"symbol": "USDJPY", "strategy_id": "T"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["trade_count"] >= 1
    assert "equity" in body
