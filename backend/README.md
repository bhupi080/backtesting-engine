# Viewer backend

```powershell
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Reads repo-root `data/` via `DATA_DIR` (default `../data`).
Optional: `TV_TRADES_TZ=Europe/Bucharest`.
