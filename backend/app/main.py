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
)
from app import ticks_service, trades_service

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
) -> SimulateResponse:
    raw = trades_service.simulate(symbol, strategy_id, from_ts, to_ts)
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
