# Viewer backend

```powershell
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Reads repo-root `data/` via `DATA_DIR` (default `../data`).
Optional: `TV_TRADES_TZ=Europe/Bucharest`.

## Tick download jobs

Uses a **copy** of `download_ticks.py` under `app/tick_download/` (repo-root CLI file is untouched).
Jobs run as `uv run python …` from the repo root (one at a time).

```http
POST /ticks/jobs
{ "cmd": "update", "symbol": "USDJPY", "side": "BOTH" }

POST /ticks/jobs
{ "cmd": "bootstrap", "symbol": "USDJPY", "from_date": "2026-04-01" }

GET  /ticks/jobs
GET  /ticks/jobs/{id}
POST /ticks/jobs/{id}/cancel
```

Do not start a dashboard job while the root CLI download is still writing `data/ticks`.

Symbols must exist in repo-root `market_hours.yml` or the API returns **400**.
