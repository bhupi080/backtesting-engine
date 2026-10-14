# backtesting-engine

Local day-wise tick store from the cTrader Open API, and (later) the backtesting engine.

```
data/ticks/{SYMBOL}/YYYY-MM-DD.parquet
data/ticks/_manifest.json
```

Day boundaries use **broker / MT5 server time** (`TICKS_BROKER_TZ`, default `Europe/Bucharest`).  
Symbol list and sessions come from `market_hours.yml`.

## Setup

```powershell
cd C:\Users\qdata\Documents\Codes\backtesting-engine
uv sync
# copy .env.example -> .env and fill CTRADER_* tokens
```

## Usage

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
