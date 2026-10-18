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
    open_time: str | None = None
    close_time: str | None = None
    open_price: float | None = None
    close_price: float | None = None
    size: float = 0.0
    pnl: float | None = None
    tv_net_pnl: float | None = None
    cumulative_pnl: float = 0.0
    status: str | None = None
    fill_entry_time: str | None = None
    fill_exit_time: str | None = None
    fill_entry_price: float | None = None
    fill_exit_price: float | None = None
    entry_slip_pips: float | None = None
    exit_slip_pips: float | None = None
    sim_pnl_usd: float | None = None
    tv_pnl_usd: float | None = None
    net_pnl_usd: float | None = None
    commission_usd: float | None = None
    max_runup_usd: float | None = None
    max_drawdown_usd: float | None = None


class EquityPoint(BaseModel):
    t: str
    equity: float
    drawdown: float = 0.0


class SideSummary(BaseModel):
    filled: int
    share_pct: float
    pnl_usd: float
    pnl_share_pct: float
    win_rate: float
    wins: int
    losses: int
    profit_factor: float | None


class TradeExtremum(BaseModel):
    trade_id: int
    pnl_usd: float


class SideAnalytics(BaseModel):
    avg_pnl_usd: float
    biggest_win_usd: float
    biggest_loss_usd: float


class PeriodPnl(BaseModel):
    period: str
    pnl_usd: float
    wins: int
    losses: int


class SimAnalytics(BaseModel):
    avg_pnl_usd: float
    avg_win_usd: float
    avg_loss_usd: float
    best_trade: TradeExtremum | None = None
    worst_trade: TradeExtremum | None = None
    by_side: dict[str, SideAnalytics] = Field(default_factory=dict)
    shortest_win_ms: int | None = None
    shortest_loss_ms: int | None = None
    avg_win_duration_ms: int | None = None
    avg_loss_duration_ms: int | None = None
    max_consecutive_wins: int
    max_consecutive_losses: int
    monthly_pnls: list[PeriodPnl] = Field(default_factory=list)
    daily_pnls: list[PeriodPnl] = Field(default_factory=list)
    session_pnls: dict[str, float] = Field(default_factory=dict)


class SimSummary(BaseModel):
    trades: int
    filled: int
    skipped: int
    sim_pnl_usd: float
    tv_pnl_usd: float
    pnl_diff_usd: float
    win_rate: float
    wins: int
    losses: int
    profit_factor: float | None
    max_drawdown_pct: float
    max_drawdown_usd: float = 0.0
    ending_equity: float
    return_pct: float
    by_side: dict[str, SideSummary] = Field(default_factory=dict)
    analytics: SimAnalytics | None = None


class SimSettings(BaseModel):
    lots: float
    commission_per_lot: float
    starting_balance: float
    contract_size: int
    pip_size: float
    chart_tf_minutes: int = 10
    analysis_tz: str | None = None


class SimulateResponse(BaseModel):
    symbol: str
    strategy_id: str
    trade_count: int
    closed_count: int
    total_pnl: float
    max_drawdown: float
    trades: list[SimTradeResult]
    equity: list[EquityPoint]
    # trade_id (string) → intra-trade floating PnL path
    trade_equity: dict[str, list[EquityPoint]] = Field(default_factory=dict)
    summary: SimSummary | None = None
    settings: SimSettings | None = None
    meta: dict[str, Any] | None = None


class SymbolStub(BaseModel):
    symbol: str
    detail: str = "stub"


class CompareStub(BaseModel):
    status: str = "stub"
    message: str = "Compare endpoint not implemented yet"
    extra: dict[str, Any] = Field(default_factory=dict)


class TickJobCreateRequest(BaseModel):
    cmd: Literal["update", "bootstrap"]
    symbol: str | None = None
    from_date: str | None = Field(
        default=None, description="Required for bootstrap (YYYY-MM-DD)"
    )
    to_date: str | None = None
    side: Literal["BOTH", "BID", "ASK"] = "BOTH"
    force: bool = False


class TickJobResponse(BaseModel):
    id: str
    cmd: str
    symbol: str | None = None
    from_date: str | None = None
    to_date: str | None = None
    side: str
    force: bool = False
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    return_code: int | None = None
    error: str | None = None
    argv: list[str] = Field(default_factory=list)
    log: list[str] = Field(default_factory=list)
    log_truncated: bool = False
    log_total_lines: int = 0
