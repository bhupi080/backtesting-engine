# backtesting-engine

Local day-wise tick store (cTrader Open API) plus a FastAPI + React viewer for datasets, trades, and tick-fill simulation.

```
data/ticks/{SYMBOL}/YYYY-MM-DD.parquet
data/ticks/_manifest.json
data/trades/{SYMBOL}/...   # TradingView CSV exports
```

Day boundaries use **broker / MT5 server time** (`TICKS_BROKER_TZ`, default `Europe/Bucharest`).  
Symbol list and sessions come from `market_hours.yml`.

## Setup

```powershell
cd C:\Users\qdata\Documents\Codes\backtesting-engine
uv sync
# copy .env.example -> .env and fill CTRADER_* tokens (needed for tick download)
```

Frontend (once):

```powershell
cd frontend
npm install
```

## Run the app

Use **two terminals**.

### 1. API (port 8000)

```powershell
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

Health check: [http://localhost:8000/health](http://localhost:8000/health)

### 2. UI (port 5173)

```powershell
cd frontend
`npm run dev`
```

Open [http://localhost:5173](http://localhost:5173).  
The UI calls the API at `http://localhost:8000` (override with `VITE_API_BASE` if needed).

### Pages

| Route | What it does |
|-------|----------------|
| Datasets | Tick coverage / days on disk |
| Trades | TradingView strategy CSVs |
| Simulate | Bar-close tick fills, PnL, equity + trade-wise curves |

## Tick download

```powershell
# one symbol from April to now (~2–3h for liquid FX)
uv run python download_ticks.py bootstrap USDJPY --from 2026-04-01

# catch up from last tick in the manifest
uv run python download_ticks.py update USDJPY

# all symbols in market_hours.yml (long)
uv run python download_ticks.py bootstrap --from 2026-04-01
```

## Notes

- API limits: 1 week per request, ~10k ticks/page, 5 historical req/s.
- Default `--side BOTH` (BID + ASK).
- Past day files are skipped on re-bootstrap unless `--force`.
