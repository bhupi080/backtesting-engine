from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class DatasetInfo(BaseModel):
    id: str
    symbol: str
    path_glob: str
    file_count: int
    row_count: int
    min_time_utc: str | None = None
    max_time_utc: str | None = None
    min_time_broker: str | None = None
    max_time_broker: str | None = None


class SchemaField(BaseModel):
    name: str
    type: str


class DatasetSchema(BaseModel):
    id: str
    fields: list[SchemaField]


class OverviewMetrics(BaseModel):
    symbol: str
    side: str | None
    from_ts: str | None
    to_ts: str | None
    tick_count: int
    bid_count: int
    ask_count: int
    min_price: float | None
    max_price: float | None
    avg_price: float | None
    last_price: float | None


class SeriesPoint(BaseModel):
    t: str
    price: float
    spread: float | None = None


class OverviewResponse(BaseModel):
    metrics: OverviewMetrics
    series: list[SeriesPoint]


class TickRow(BaseModel):
    timestamp_ms: int
    time_utc: str
    time_broker: str
    side: str
    price: float
    symbol: str


class PaginatedTicks(BaseModel):
    total: int
    page: int
    page_size: int
    rows: list[TickRow]


class StrategyInfo(BaseModel):
    symbol: str
    strategy_id: str
    trade_files: list[str]
    trade_count: int
    csv_count: int = 0
    latest_file: str | None = None


class TradeRow(BaseModel):
    trade_id: int
    symbol: str
    strategy_id: str
    side: Literal["long", "short"]
    open_time: str | None
    open_price: float | None
    close_time: str | None
    close_price: float | None
    size: float
    tv_net_pnl: float | None = None
    tv_commission: float | None = None
    signal_entry: str | None = None
    signal_exit: str | None = None
    is_open: bool = False


class PaginatedTrades(BaseModel):
    total: int
    page: int
    page_size: int
    rows: list[TradeRow]


class SimTradeResult(BaseModel):
    trade_id: int
    side: str
    open_time: str | None
    close_time: str | None
    open_price: float | None
    close_price: float | None
    size: float
    pnl: float | None
    tv_net_pnl: float | None
    cumulative_pnl: float


class EquityPoint(BaseModel):
    t: str
    equity: float
    drawdown: float


class SimulateResponse(BaseModel):
    symbol: str
    strategy_id: str
    trade_count: int
    closed_count: int
    total_pnl: float
    max_drawdown: float
    trades: list[SimTradeResult]
    equity: list[EquityPoint]


class SymbolStub(BaseModel):
    symbol: str
    detail: str = "stub"


class CompareStub(BaseModel):
    status: str = "stub"
    message: str = "Compare endpoint not implemented yet"
    extra: dict[str, Any] = Field(default_factory=dict)
