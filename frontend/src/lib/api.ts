const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000"

async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, API_BASE)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, API_BASE)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export type Dataset = {
  id: string
  symbol: string
  path_glob: string
  file_count: number
  row_count: number
  min_time_utc: string | null
  max_time_utc: string | null
  min_time_broker: string | null
  max_time_broker: string | null
}

export type OverviewResponse = {
  metrics: {
    symbol: string
    side: string | null
    from_ts: string | null
    to_ts: string | null
    tick_count: number
    bid_count: number
    ask_count: number
    min_price: number | null
    max_price: number | null
    avg_price: number | null
    last_price: number | null
  }
  series: { t: string; price: number; spread: number | null }[]
}

export type PaginatedTicks = {
  total: number
  page: number
  page_size: number
  rows: {
    timestamp_ms: number
    time_utc: string
    time_broker: string
    side: string
    price: number
    symbol: string
  }[]
}

export type StrategyInfo = {
  symbol: string
  strategy_id: string
  trade_files: string[]
  trade_count: number
  csv_count: number
  latest_file: string | null
}

export type PaginatedTrades = {
  total: number
  page: number
  page_size: number
  rows: {
    trade_id: number
    symbol: string
    strategy_id: string
    side: string
    open_time: string | null
    open_price: number | null
    close_time: string | null
    close_price: number | null
    size: number
    tv_net_pnl: number | null
    is_open: boolean
  }[]
}

export type SimulateResponse = {
  symbol: string
  strategy_id: string
  trade_count: number
  closed_count: number
  total_pnl: number
  max_drawdown: number
  trades: {
    trade_id: number
    side: string
    pnl: number | null
    tv_net_pnl: number | null
    cumulative_pnl: number
    open_time: string | null
    close_time: string | null
    open_price?: number | null
    close_price?: number | null
    size?: number
    status?: string | null
    fill_entry_price?: number | null
    fill_exit_price?: number | null
    entry_slip_pips?: number | null
    exit_slip_pips?: number | null
    sim_pnl_usd?: number | null
    tv_pnl_usd?: number | null
    net_pnl_usd?: number | null
    commission_usd?: number | null
    max_runup_usd?: number | null
    max_drawdown_usd?: number | null
  }[]
  equity: { t: string; equity: number; drawdown: number }[]
  /** trade_id → intra-trade floating PnL path */
  trade_equity?: Record<string, { t: string; equity: number; drawdown: number }[]>
  summary?: {
    trades: number
    filled: number
    skipped: number
    sim_pnl_usd: number
    tv_pnl_usd: number
    pnl_diff_usd: number
    win_rate: number
    wins: number
    losses: number
    profit_factor: number | null
    max_drawdown_pct: number
    ending_equity: number
    return_pct: number
  }
  settings?: {
    lots: number
    commission_per_lot: number
    starting_balance: number
    contract_size: number
    pip_size: number
    chart_tf_minutes: number
  }
  meta?: { rule?: string }
}

export type TickJob = {
  id: string
  cmd: string
  symbol: string | null
  from_date: string | null
  to_date: string | null
  side: string
  force: boolean
  status: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  return_code: number | null
  error: string | null
  argv: string[]
  log: string[]
  log_truncated: boolean
  log_total_lines: number
}

export type TickJobCreate = {
  cmd: "update" | "bootstrap"
  symbol?: string
  from_date?: string
  to_date?: string
  side?: "BOTH" | "BID" | "ASK"
  force?: boolean
}

export const api = {
  health: () => getJson<{ status: string }>("/health"),
  datasets: () => getJson<Dataset[]>("/datasets"),
  marketHoursSymbols: () => getJson<string[]>("/market-hours/symbols"),
  overview: (p: {
    symbol: string
    from?: string
    to?: string
    side?: string
  }) => getJson<OverviewResponse>("/overview", p),
  ticks: (p: {
    symbol: string
    from?: string
    to?: string
    side?: string
    sort?: string
    order?: string
    page?: number
    page_size?: number
  }) => getJson<PaginatedTicks>("/ticks", p),
  strategies: () => getJson<StrategyInfo[]>("/strategies"),
  trades: (p: {
    symbol: string
    strategy_id: string
    sort?: string
    order?: string
    page?: number
    page_size?: number
  }) => getJson<PaginatedTrades>("/trades", p),
  simulate: (p: {
    symbol: string
    strategy_id: string
    from?: string
    to?: string
    lots?: number
    commission_per_lot?: number
    starting_balance?: number
    chart_tf_minutes?: number
  }) => getJson<SimulateResponse>("/simulate", p),
  createTickJob: (body: TickJobCreate) =>
    postJson<TickJob>("/ticks/jobs", body),
  listTickJobs: (limit = 20) =>
    getJson<TickJob[]>("/ticks/jobs", { limit }),
  getTickJob: (id: string, log_tail = 200) =>
    getJson<TickJob>(`/ticks/jobs/${id}`, { log_tail }),
  cancelTickJob: (id: string) =>
    postJson<TickJob>(`/ticks/jobs/${id}/cancel`),
}
