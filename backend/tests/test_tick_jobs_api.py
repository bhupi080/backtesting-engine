from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_tick_jobs_empty_ok() -> None:
    r = client.get("/ticks/jobs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_bootstrap_requires_from_date() -> None:
    r = client.post(
        "/ticks/jobs",
        json={"cmd": "bootstrap", "symbol": "USDJPY"},
    )
    assert r.status_code == 400


def test_symbol_not_in_market_hours_rejected() -> None:
    r = client.post(
        "/ticks/jobs",
        json={
            "cmd": "bootstrap",
            "symbol": "NOTAREALPAIR",
            "from_date": "2026-04-01",
        },
    )
    assert r.status_code == 400
    assert "market_hours.yml" in r.json()["detail"]


def test_get_missing_job() -> None:
    r = client.get("/ticks/jobs/does-not-exist")
    assert r.status_code == 404
