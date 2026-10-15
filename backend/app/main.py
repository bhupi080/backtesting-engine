from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app import duckdb_client as db
from app.config import get_settings
from app.models import (
    CompareStub,
    DatasetInfo,
    DatasetSchema,
    HealthResponse,
    OverviewResponse,
    PaginatedTicks,
    PaginatedTrades,
    SchemaField,
    SimulateResponse,
    StrategyInfo,
    SymbolStub,
    TickJobCreateRequest,
    TickJobResponse,
)
from app import tick_sim, ticks_service, trades_service
from app.tick_download import jobs as tick_jobs
from app.tick_download.jobs import TickJobCreate

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    yield


app = FastAPI(title="backtesting-viewer", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/datasets", response_model=list[DatasetInfo])
def datasets() -> list[DatasetInfo]:
    return [DatasetInfo(**d) for d in ticks_service.list_datasets()]


@app.get("/datasets/{dataset_id}/schema", response_model=DatasetSchema)
def dataset_schema(dataset_id: str) -> DatasetSchema:
    try:
        raw = ticks_service.dataset_schema(dataset_id)
    except FileNotFoundError:
        raise HTTPException(404, f"dataset not found: {dataset_id}") from None
    return DatasetSchema(
        id=raw["id"],
        fields=[SchemaField(**f) for f in raw["fields"]],
    )


@app.get("/overview", response_model=OverviewResponse)
def overview(
    symbol: str = Query(...),
    from_ts: str | None = Query(None, alias="from"),
    to_ts: str | None = Query(None, alias="to"),
    side: str | None = None,
) -> OverviewResponse:
    if not (settings.ticks_dir / symbol).exists():
        raise HTTPException(404, f"symbol not found: {symbol}")
    try:
        raw = ticks_service.overview(symbol, from_ts, to_ts, side)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e)) from e
    return OverviewResponse(**raw)


@app.get("/ticks", response_model=PaginatedTicks)
def ticks(
    symbol: str = Query(...),
    from_ts: str | None = Query(None, alias="from"),
    to_ts: str | None = Query(None, alias="to"),
    side: str | None = None,
    sort: str = "timestamp_ms",
    order: str = "asc",
    page: int = 1,
    page_size: int = 100,
) -> PaginatedTicks:
    if not (settings.ticks_dir / symbol).exists():
        raise HTTPException(404, f"symbol not found: {symbol}")
    raw = ticks_service.list_ticks(
        symbol, from_ts, to_ts, side, sort, order, page, page_size
    )
    return PaginatedTicks(**raw)


@app.get("/strategies", response_model=list[StrategyInfo])
def strategies() -> list[StrategyInfo]:
    return [StrategyInfo(**s) for s in trades_service.discover_strategies()]


@app.get("/trades", response_model=PaginatedTrades)
def trades(
    symbol: str = Query(...),
    strategy_id: str = Query(...),
    sort: str = "trade_id",
    order: str = "asc",
    page: int = 1,
    page_size: int = 50,
) -> PaginatedTrades:
    raw = trades_service.list_trades_page(
        symbol, strategy_id, page, page_size, sort, order
    )
    return PaginatedTrades(**raw)


@app.get("/simulate", response_model=SimulateResponse)
def simulate(
    symbol: str = Query(...),
    strategy_id: str = Query(...),
    from_ts: str | None = Query(None, alias="from"),
    to_ts: str | None = Query(None, alias="to"),
    lots: float = Query(0.1, ge=0.01, le=10.0),
    commission_per_lot: float = Query(7.0, ge=0.0, le=50.0),
    starting_balance: float = Query(2000.0, ge=100.0, le=1_000_000.0),
    chart_tf_minutes: int = Query(10, ge=0, le=240),
) -> SimulateResponse:
    raw = tick_sim.simulate(
        symbol,
        strategy_id,
        lots=lots,
        commission_per_lot=commission_per_lot,
        starting_balance=starting_balance,
        chart_tf_minutes=chart_tf_minutes,
        from_ts=from_ts,
        to_ts=to_ts,
    )
    return SimulateResponse(**raw)


@app.get("/symbols", response_model=list[SymbolStub])
def symbols() -> list[SymbolStub]:
    manifest = ticks_service.load_manifest()
    return [SymbolStub(symbol=s) for s in sorted(manifest.get("symbols", {}).keys())]


@app.get("/symbols/{symbol}", response_model=SymbolStub)
def symbol_detail(symbol: str) -> SymbolStub:
    return SymbolStub(symbol=symbol, detail="stub")


@app.get("/compare", response_model=CompareStub)
def compare() -> CompareStub:
    return CompareStub()


@app.get("/market-hours/symbols", response_model=list[str])
def market_hours_symbols() -> list[str]:
    """Symbols defined in repo-root market_hours.yml (required for tick jobs)."""
    try:
        return tick_jobs.list_market_hours_symbols()
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/ticks/jobs", response_model=TickJobResponse, status_code=201)
def create_tick_job(body: TickJobCreateRequest) -> TickJobResponse:
    """Start bootstrap/update via backend copy of download_ticks (subprocess).

    Does not use or modify repo-root download_ticks.py. One job at a time.
    Avoid starting while a CLI download is writing the same data/ticks files.
    """
    try:
        job = tick_jobs.start_job(
            TickJobCreate(
                cmd=body.cmd,
                symbol=body.symbol,
                from_date=body.from_date,
                to_date=body.to_date,
                side=body.side,
                force=body.force,
            )
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    return TickJobResponse(**job.to_dict(log_tail=50))


@app.get("/ticks/jobs", response_model=list[TickJobResponse])
def list_tick_jobs(limit: int = Query(20, ge=1, le=100)) -> list[TickJobResponse]:
    return [
        TickJobResponse(**j.to_dict(log_tail=20)) for j in tick_jobs.list_jobs(limit=limit)
    ]


@app.get("/ticks/jobs/{job_id}", response_model=TickJobResponse)
def get_tick_job(
    job_id: str,
    log_tail: int = Query(200, ge=0, le=2000),
) -> TickJobResponse:
    job = tick_jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, f"job not found: {job_id}")
    return TickJobResponse(**job.to_dict(log_tail=log_tail))


@app.post("/ticks/jobs/{job_id}/cancel", response_model=TickJobResponse)
def cancel_tick_job(job_id: str) -> TickJobResponse:
    try:
        job = tick_jobs.cancel_job(job_id)
    except KeyError:
        raise HTTPException(404, f"job not found: {job_id}") from None
    return TickJobResponse(**job.to_dict(log_tail=50))
