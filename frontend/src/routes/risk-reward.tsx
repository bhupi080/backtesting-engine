import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Scale,
  Search,
  ZoomIn,
} from "lucide-react"

import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts"

import { EquityCurveZoomModal } from "@/components/charts"
import { LoadingState } from "@/components/loading-state"
import { SimOverviewPanel } from "@/components/sim-overview-panel"
import { api, type RiskRewardGrid, type SimulateResponse, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import {
  getRiskRewardSession,
  saveRiskRewardSession,
} from "@/lib/run-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { formatHumanDate, formatHumanDateDetail } from "@/lib/time"
import { cn } from "@/lib/utils"
import {
  DeferredTradeEquityChart,
  SimAnalyticsPanel,
  buildSessionBands,
} from "@/routes/simulate"

export const Route = createFileRoute("/risk-reward")({
  component: RiskRewardRoute,
})

function RiskRewardRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (pathname !== "/risk-reward") return <Outlet />
  return <RiskRewardPage />
}

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Bucharest", label: "Bucharest" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
]

export const ATR_BARS = [
  { value: "1", label: "1 min" },
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hour" },
]

type SymbolGroup = { symbol: string; strategies: StrategyInfo[] }

type DualResult = {
  signal: SimulateResponse
  barClose: SimulateResponse | null
  rawSignal: SimulateResponse
  rawBarClose: SimulateResponse | null
  chartTf: number
}

type RunConfig = {
  symbol: string
  strategyId: string
  lots: number
  commission: number
  balance: number
  chartTf: number
  atrBar: number
  atrPeriod: number
  tpMult: number
  slMult: number
}

function formatMult(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatPnl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${formatUsd(n)}`
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-foreground"
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400"
}

function formatPx(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const abs = Math.abs(n)
  const digits = abs >= 50 ? 3 : abs >= 5 ? 4 : 5
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatCompact(n: number): string {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

function formatSimTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return "—"
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const EXIT_LABEL: Record<string, string> = {
  tp: "Take profit",
  sl: "Stop",
  signal: "CSV exit",
  no_atr: "No ATR",
}

function exitBadgeClass(reason: string | null | undefined): string {
  if (reason === "tp") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  if (reason === "sl") return "bg-rose-500/15 text-rose-700 dark:text-rose-400"
  if (reason === "signal") return "bg-amber-500/15 text-amber-800 dark:text-amber-300"
  return "bg-muted text-muted-foreground"
}

function RiskRewardPage() {
  const saved = getRiskRewardSession()
  const { applied, selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [lots, setLots] = useState(saved.lots)
  const [commission, setCommission] = useState(saved.commission)
  const [balance, setBalance] = useState(saved.balance)
  const [chartTf, setChartTf] = useState(saved.chartTf)
  const [atrBar, setAtrBar] = useState(saved.atrBar)
  const [atrPeriod, setAtrPeriod] = useState(saved.atrPeriod)
  const [tpMult, setTpMult] = useState(saved.tpMult)
  const [slMult, setSlMult] = useState(saved.slMult)
  const [timeZone, setTimeZone] = useState(saved.timeZone)
  const [runKey, setRunKey] = useState(saved.runKey)
  const [committed, setCommitted] = useState<RunConfig | null>(saved.committed)
  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "trades" | "grid">(
    saved.activeTab === "suggestions" ? "overview" : saved.activeTab,
  )
  const [fillGroup, setFillGroup] = useState(saved.fillGroup)
  const [strategyPickerOpen, setStrategyPickerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(saved.sidebarOpen)
  const resumedRun = useRef(saved.runKey)

  const strategiesQ = useQuery({
    queryKey: ["strategies"],
    queryFn: api.strategies,
  })
  const strategies = strategiesQ.data ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return strategies
    return strategies.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.strategy_id.toLowerCase().includes(q),
    )
  }, [strategies, query])

  const groups = useMemo(() => {
    const map = new Map<string, StrategyInfo[]>()
    for (const s of filtered) {
      const list = map.get(s.symbol)
      if (list) list.push(s)
      else map.set(s.symbol, [s])
    }
    const out: SymbolGroup[] = []
    for (const [symbol, list] of map) {
      list.sort((a, b) => a.strategy_id.localeCompare(b.strategy_id))
      out.push({ symbol, strategies: list })
    }
    out.sort((a, b) => a.symbol.localeCompare(b.symbol))
    return out
  }, [filtered])

  useEffect(() => {
    if (!applied.symbol) return
    setExpanded((prev) =>
      prev[applied.symbol] ? prev : { ...prev, [applied.symbol]: true },
    )
  }, [applied.symbol])

  const simQ = useQuery({
    queryKey: ["risk-reward", committed, runKey, timeZone],
    queryFn: async (): Promise<DualResult> => {
      if (!committed) throw new Error("No run config")
      const shared = {
        symbol: committed.symbol,
        strategy_id: committed.strategyId,
        lots: committed.lots,
        commission_per_lot: committed.commission,
        starting_balance: committed.balance,
        analysis_tz: timeZone,
      }
      const atr = {
        ...shared,
        atr_bar_minutes: committed.atrBar,
        atr_period: committed.atrPeriod,
        tp_atr_mult: committed.tpMult,
        sl_atr_mult: committed.slMult,
      }
      if (committed.chartTf <= 0) {
        const [signal, rawSignal] = await Promise.all([
          api.riskReward({ ...atr, chart_tf_minutes: 0 }),
          api.simulate({ ...shared, chart_tf_minutes: 0 }),
        ])
        return { signal, barClose: null, rawSignal, rawBarClose: null, chartTf: 0 }
      }
      const [signal, barClose, rawSignal, rawBarClose] = await Promise.all([
        api.riskReward({ ...atr, chart_tf_minutes: 0 }),
        api.riskReward({ ...atr, chart_tf_minutes: committed.chartTf }),
        api.simulate({ ...shared, chart_tf_minutes: 0 }),
        api.simulate({ ...shared, chart_tf_minutes: committed.chartTf }),
      ])
      return { signal, barClose, rawSignal, rawBarClose, chartTf: committed.chartTf }
    },
    enabled: Boolean(committed && runKey > 0),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    if (!committed) return
    if (
      committed.symbol === applied.symbol &&
      committed.strategyId === applied.strategyId
    ) {
      return
    }
    setRunKey(0)
    setCommitted(null)
  }, [applied.symbol, applied.strategyId, committed])

  useEffect(() => {
    saveRiskRewardSession({
      lots,
      commission,
      balance,
      chartTf,
      atrBar,
      atrPeriod,
      tpMult,
      slMult,
      timeZone,
      runKey,
      committed,
      activeTab,
      fillGroup,
      sidebarOpen,
    })
  }, [
    lots,
    commission,
    balance,
    chartTf,
    atrBar,
    atrPeriod,
    tpMult,
    slMult,
    timeZone,
    runKey,
    committed,
    activeTab,
    fillGroup,
    sidebarOpen,
  ])

  useEffect(() => {
    if (!simQ.data || runKey === 0 || resumedRun.current === runKey) return
    resumedRun.current = runKey
    setFillGroup(simQ.data.barClose ? "barClose" : "signal")
  }, [simQ.data, runKey])

  const settingsDirty = Boolean(
    committed &&
      (committed.lots !== lots ||
        committed.commission !== commission ||
        committed.balance !== balance ||
        committed.chartTf !== chartTf ||
        committed.atrBar !== atrBar ||
        committed.atrPeriod !== atrPeriod ||
        committed.tpMult !== tpMult ||
        committed.slMult !== slMult ||
        committed.symbol !== applied.symbol ||
        committed.strategyId !== applied.strategyId),
  )

  const activeSim: SimulateResponse | null = useMemo(() => {
    if (!simQ.data) return null
    if (fillGroup === "barClose" && simQ.data.barClose) return simQ.data.barClose
    return simQ.data.signal
  }, [simQ.data, fillGroup])

  const activeRaw: SimulateResponse | null = useMemo(() => {
    if (!simQ.data) return null
    if (fillGroup === "barClose" && simQ.data.rawBarClose) return simQ.data.rawBarClose
    return simQ.data.rawSignal
  }, [simQ.data, fillGroup])

  const summary = activeSim?.summary
  const startingBalance = activeSim?.settings?.starting_balance ?? balance

  const chartEquity = useMemo(() => {
    const rows = activeSim?.equity ?? []
    return rows.map((p) => ({
      t: p.t,
      equity: p.equity - startingBalance,
      drawdown: p.drawdown,
      exitReason: p.exit_reason,
    }))
  }, [activeSim?.equity, startingBalance])

  const exitMix = useMemo(() => {
    const mix = {
      tp: { n: 0, pnl: 0 },
      sl: { n: 0, pnl: 0 },
      signal: { n: 0, pnl: 0 },
    }
    for (const t of activeSim?.trades ?? []) {
      if (t.status !== "ok" || t.net_pnl_usd == null) continue
      const key =
        t.exit_reason === "tp" || t.exit_reason === "sl" ? t.exit_reason : "signal"
      mix[key].n += 1
      mix[key].pnl += t.net_pnl_usd
    }
    return mix
  }, [activeSim?.trades])

  const hasDualGroups = Boolean(simQ.data?.barClose)
  const signalPnl = simQ.data?.signal.summary?.sim_pnl_usd
  const barClosePnl = simQ.data?.barClose?.summary?.sim_pnl_usd
  const signalRawPnl = simQ.data?.rawSignal.summary?.sim_pnl_usd
  const barCloseRawPnl = simQ.data?.rawBarClose?.summary?.sim_pnl_usd
  const atrPnl = summary?.sim_pnl_usd
  const rawPnl = activeRaw?.summary?.sim_pnl_usd
  const pnlDelta =
    atrPnl != null && rawPnl != null ? atrPnl - rawPnl : null
  const periodFrom = chartEquity[0]?.t
  const periodTo =
    chartEquity.length > 0 ? chartEquity[chartEquity.length - 1]?.t : undefined
  const fillModeLabel = hasDualGroups
    ? fillGroup === "signal"
      ? "At signal · 0 min"
      : `After bar close · ${simQ.data?.chartTf ?? chartTf} min`
    : "At signal · 0 min"

  function isExpanded(symbol: string): boolean {
    if (query.trim()) return true
    if (expanded[symbol] != null) return expanded[symbol]
    return symbol === applied.symbol
  }

  function runSim(next?: { tpMult?: number; slMult?: number }) {
    if (!applied.symbol || !applied.strategyId) return
    const nextTp = next?.tpMult ?? tpMult
    const nextSl = next?.slMult ?? slMult
    if (atrPeriod < 2 || nextTp <= 0 || nextSl <= 0) return
    if (next?.tpMult != null) setTpMult(next.tpMult)
    if (next?.slMult != null) setSlMult(next.slMult)
    setCommitted({
      symbol: applied.symbol,
      strategyId: applied.strategyId,
      lots,
      commission,
      balance,
      chartTf,
      atrBar,
      atrPeriod,
      tpMult: nextTp,
      slMult: nextSl,
    })
    setRunKey((k) => k + 1)
    if (next) setActiveTab("overview")
  }

  const hasSelection = Boolean(applied.symbol && applied.strategyId)
  const hasRun = Boolean(committed && runKey > 0)
  const atrBarLabel = ATR_BARS.find((b) => Number(b.value) === atrBar)?.label ?? `${atrBar} min`

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background/60 lg:flex-row">
        <aside
          data-state={sidebarOpen ? "expanded" : "collapsed"}
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden border-border bg-muted/20",
            "transition-[width,max-height] duration-200 ease-linear",
            "max-lg:border-b lg:border-r",
            sidebarOpen
              ? "max-h-[42%] w-full lg:max-h-none lg:w-64"
              : "max-h-0 w-full border-transparent lg:max-h-none lg:w-0",
          )}
        >
          <div className="flex h-full w-full min-w-0 flex-1 flex-col lg:min-w-64">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Setup
              </p>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                title="Hide sidebar"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="size-3.5" />
                <span className="sr-only">Hide sidebar</span>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Strategy
                </p>
                <Dialog open={strategyPickerOpen} onOpenChange={setStrategyPickerOpen}>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs font-semibold">
                            {applied.symbol || "Symbol"}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {applied.strategyId || "Pick a strategy"}
                          </p>
                        </div>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    }
                  />
                  <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Strategy</DialogTitle>
                    </DialogHeader>
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search symbol or strategy"
                        className="h-9 pl-8 text-[12px]"
                      />
                    </div>
                    <div className="max-h-[50vh] overflow-y-auto pr-1">
                      {strategiesQ.isLoading ? (
                        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                          Loading strategies…
                        </p>
                      ) : groups.length === 0 ? (
                        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                          No strategies match.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {groups.map((group) => {
                            const open = isExpanded(group.symbol)
                            return (
                              <li key={group.symbol}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpanded((prev) => ({
                                      ...prev,
                                      [group.symbol]: !open,
                                    }))
                                  }
                                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                                >
                                  <ChevronDown
                                    className={cn(
                                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                      !open && "-rotate-90",
                                    )}
                                  />
                                  <span className="font-mono text-[12px] font-semibold">
                                    {group.symbol}
                                  </span>
                                </button>
                                {open ? (
                                  <ul className="mt-0.5 mb-1 ml-2 space-y-0.5 border-l border-border/60 pl-2">
                                    {group.strategies.map((s) => {
                                      const active =
                                        s.symbol === applied.symbol &&
                                        s.strategy_id === applied.strategyId
                                      return (
                                        <li key={`${s.symbol}-${s.strategy_id}`}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              selectAndApply({
                                                symbol: s.symbol,
                                                strategyId: s.strategy_id,
                                              })
                                              setStrategyPickerOpen(false)
                                            }}
                                            className={cn(
                                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                                              active
                                                ? "bg-orange-500/10 ring-1 ring-orange-500/25"
                                                : "hover:bg-muted/50",
                                            )}
                                          >
                                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                              {s.strategy_id}
                                            </span>
                                            <span className="text-[10px] tabular-nums text-muted-foreground">
                                              {formatCompact(s.trade_count)}
                                            </span>
                                          </button>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  ATR levels
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Bar size
                  </label>
                  <Select
                    value={String(atrBar)}
                    onValueChange={(v) => v && setAtrBar(Number(v))}
                  >
                    <SelectTrigger size="sm" className="h-9 w-full text-[12px]">
                      <SelectValue>{atrBarLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ATR_BARS.map((bar) => (
                        <SelectItem key={bar.value} value={bar.value}>
                          {bar.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Length" value={atrPeriod} onChange={setAtrPeriod} step={1} min={2} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Take profit ×" value={tpMult} onChange={setTpMult} step={0.1} min={0.1} />
                  <Field label="Stop ×" value={slMult} onChange={setSlMult} step={0.1} min={0.1} />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Uses the last {atrPeriod} completed {atrBarLabel} bars before the open.
                  Target and stop stay fixed. If neither is hit, the trade closes at the CSV exit.
                </p>
              </div>

              <div className="space-y-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Account
                </p>
                <Field label="Lots" value={lots} onChange={setLots} step={0.01} min={0.01} />
                <Field label="Commission / lot" value={commission} onChange={setCommission} step={0.1} min={0} />
                <Field label="Balance" value={balance} onChange={setBalance} step={100} min={100} />
                <Field label="Chart TF (min)" value={chartTf} onChange={setChartTf} step={1} min={0} />
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Time zone
                  </label>
                  <Select value={timeZone} onValueChange={(v) => v && setTimeZone(v)}>
                    <SelectTrigger size="sm" className="h-9 w-full text-[12px]">
                      <SelectValue>
                        {TIMEZONES.find((t) => t.value === timeZone)?.label ?? timeZone}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                className="mt-1 gap-1.5 bg-orange-600 text-white hover:bg-orange-600/90"
                disabled={!hasSelection || simQ.isFetching}
                onClick={runSim}
              >
                {simQ.isFetching ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
                Run
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {hasRun && activeSim?.meta?.rule
                  ? activeSim.meta.rule
                  : hasSelection
                    ? `Ready · ${applied.symbol} / ${applied.strategyId}`
                    : "Pick a symbol and strategy, then click Run"}
              </p>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 overflow-hidden border-b border-border px-3 transition-[max-height,opacity,padding] duration-200 ease-linear",
              sidebarOpen ? "max-h-0 opacity-0 py-0" : "max-h-10 opacity-100 py-1.5",
            )}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-3.5" />
              Setup
            </button>
            {hasSelection ? (
              <span className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{applied.symbol}</span>
                <span className="mx-1">/</span>
                {applied.strategyId}
              </span>
            ) : null}
          </div>

          {!hasSelection ? (
            <EmptyState
              title="Choose a strategy"
              body="Select a TradingView strategy, set the ATR bar size and the take-profit and stop multipliers, then press Run."
            />
          ) : !hasRun ? (
            <EmptyState
              title={`${applied.symbol} / ${applied.strategyId}`}
              body="Nothing has been run yet. Take-profit and stop are set from the ATR of bars that already closed before each open."
            />
          ) : simQ.isFetching ? (
            <LoadingState
              title="Simulating ATR exits"
              message={
                committed && committed.chartTf > 0
                  ? `ATR exits and raw CSV exits, at the signal and after the ${committed.chartTf}m bar…`
                  : `ATR exits and raw CSV exits for ${applied.symbol} / ${applied.strategyId}…`
              }
            />
          ) : simQ.isError ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <p className="text-sm text-destructive">{String(simQ.error)}</p>
            </div>
          ) : activeSim && summary ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border px-3 py-2">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold tracking-tight">
                        {applied.symbol}
                      </span>
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[9px] text-orange-800 dark:text-orange-300"
                      >
                        {applied.strategyId}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">· {fillModeLabel}</span>
                      <span className="text-[10px] text-muted-foreground">
                        · ATR {committed?.atrPeriod} ×{" "}
                        {ATR_BARS.find((b) => Number(b.value) === committed?.atrBar)?.label ??
                          `${committed?.atrBar ?? atrBar} min`}
                      </span>
                      {settingsDirty ? (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-400">
                          Settings changed — click Run
                        </span>
                      ) : null}
                    </div>
                    {periodFrom && periodTo ? (
                      <p className="mt-0.5 truncate text-[12px] font-medium tracking-tight">
                        {formatHumanDate(periodFrom, timeZone)}
                        <span className="mx-1.5 font-normal text-muted-foreground">→</span>
                        {formatHumanDate(periodTo, timeZone)}
                        <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
                          {formatHumanDateDetail(periodFrom, timeZone)}
                          <span className="mx-1">→</span>
                          {formatHumanDateDetail(periodTo, timeZone)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-1 items-center justify-center gap-1.5">
                    <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                      TP ×{formatMult(committed?.tpMult)}
                    </span>
                    <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 font-mono text-[12px] font-semibold text-rose-700 dark:text-rose-400">
                      SL ×{formatMult(committed?.slMult)}
                    </span>
                  </div>
                  {hasDualGroups ? (
                    <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:w-[28rem]">
                      <FillGroupCard
                        active={fillGroup === "signal"}
                        title="At signal"
                        tfLabel="0m"
                        pnl={signalPnl}
                        rawPnl={signalRawPnl}
                        recommended
                        onClick={() => setFillGroup("signal")}
                      />
                      <FillGroupCard
                        active={fillGroup === "barClose"}
                        title="Bar close"
                        tfLabel={`${simQ.data?.chartTf ?? chartTf}m`}
                        pnl={barClosePnl}
                        rawPnl={barCloseRawPnl}
                        onClick={() => setFillGroup("barClose")}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2">
                {(
                  [
                    { id: "overview", label: "Overview" },
                    { id: "analytics", label: "Analytics" },
                    { id: "trades", label: "Trades" },
                    { id: "grid", label: "Equity by trade" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative shrink-0 px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors",
                      activeTab === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {activeTab === tab.id ? (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-orange-500" />
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeTab === "overview" ? (
                  <div className="flex flex-col">
                    <ResultStrip
                      atrPnl={atrPnl}
                      rawPnl={rawPnl}
                      delta={pnlDelta}
                      exits={[
                        { label: "Take profit", n: exitMix.tp.n, pnl: exitMix.tp.pnl, fill: "#10b981" },
                        { label: "Stop", n: exitMix.sl.n, pnl: exitMix.sl.pnl, fill: "#f43f5e" },
                        { label: "CSV exit", n: exitMix.signal.n, pnl: exitMix.signal.pnl, fill: "#f59e0b" },
                      ]}
                    />
                    <SimOverviewPanel
                      summary={summary}
                      equity={chartEquity}
                      trades={activeSim.trades}
                      timeZone={timeZone}
                      hideKpis
                    />
                  </div>
                ) : activeTab === "analytics" ? (
                  <SimAnalyticsPanel
                    summary={summary}
                    trades={activeSim.trades}
                    equity={chartEquity}
                    timeZone={timeZone}
                  />
                ) : activeTab === "grid" ? (
                  <EquityCurveGrid
                    rows={activeSim.trades}
                    tradeEquity={activeSim.trade_equity ?? {}}
                    timeZone={timeZone}
                  />
                ) : (
                  <RrTradesTable
                    rows={activeSim.trades}
                    rawRows={activeRaw?.trades ?? []}
                    tradeEquity={activeSim.trade_equity ?? {}}
                    timeZone={timeZone}
                  />
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Scale className="size-8 text-orange-500/50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  step,
  min,
  compact = false,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
  min: number
  compact?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className={cn(
          "text-[10px] font-medium text-muted-foreground",
          !compact && "tracking-wide uppercase",
        )}
      >
        {label}
      </span>
      <Input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn("w-full font-mono text-[12px]", compact ? "h-8" : "h-9")}
      />
    </label>
  )
}

function FillGroupCard({
  active,
  title,
  tfLabel,
  pnl,
  rawPnl,
  recommended = false,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  pnl: number | null | undefined
  rawPnl: number | null | undefined
  recommended?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-1.5 text-left transition-all",
        active
          ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[10px] font-medium text-muted-foreground">
          {title}
          <span className="ml-1 font-mono tabular-nums">· {tfLabel}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {recommended ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-white">
              Recommended
            </span>
          ) : null}
          {active ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-white">
              On
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">ATR</p>
          <p className={cn("font-mono text-[13px] font-semibold tabular-nums", pnlClass(pnl))}>
            {formatPnl(pnl)}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">No ATR</p>
          <p className={cn("font-mono text-[13px] font-semibold tabular-nums", pnlClass(rawPnl))}>
            {formatPnl(rawPnl)}
          </p>
        </div>
      </div>
    </button>
  )
}

const exitChartConfig = {
  pnl: { label: "PnL" },
} satisfies ChartConfig

function HitCountLabel(props: {
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  value?: unknown
}) {
  const x = Number(props.x)
  const y = Number(props.y)
  const width = Number(props.width)
  const height = Number(props.height)
  if (![x, y, width, height].every(Number.isFinite)) return <g />
  const tall = Math.abs(height) >= 36
  const cy = tall ? y + height / 2 : height >= 0 ? y - 12 : y + height - 12
  return (
    <text
      x={x + width / 2}
      y={cy}
      textAnchor="middle"
      dominantBaseline="middle"
      fill={tall ? "#fff" : "currentColor"}
      fontSize={13}
      fontWeight={650}
    >
      {props.value == null ? "" : String(props.value)}
    </text>
  )
}

function ResultStrip({
  atrPnl,
  rawPnl,
  delta,
  exits,
}: {
  atrPnl: number | null | undefined
  rawPnl: number | null | undefined
  delta: number | null | undefined
  exits: { label: string; n: number; pnl: number; fill: string }[]
}) {
  const totals = [
    { label: "ATR exits", value: atrPnl },
    { label: "Before TP/SL", value: rawPnl },
    { label: "Difference", value: delta },
  ]
  const byLabel = new Map(exits.map((item) => [item.label, item]))
  return (
    <div className="mx-3 mt-3 overflow-hidden rounded-xl border border-border/70 bg-card/40">
      <div className="grid grid-cols-3 divide-x divide-border/70">
        {totals.map((item) => (
          <div key={item.label} className="px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className={cn("mt-1 font-mono text-xl font-semibold tabular-nums", pnlClass(item.value))}>
              {formatPnl(item.value)}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-border/70 px-2 pt-2 pb-1">
        <ChartContainer config={exitChartConfig} className="aspect-auto h-[210px] w-full">
          <BarChart data={exits} margin={{ top: 16, right: 12, left: 12, bottom: 36 }}>
            <YAxis hide domain={["auto", "auto"]} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={(props) => {
                const payload = props.payload as { value?: string } | undefined
                const row = byLabel.get(payload?.value ?? "")
                const x = Number(props.x) || 0
                const y = Number(props.y) || 0
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      textAnchor="middle"
                      dy={14}
                      fill="currentColor"
                      fontSize={11}
                      className="fill-muted-foreground"
                    >
                      {payload?.value}
                    </text>
                    <text
                      textAnchor="middle"
                      dy={30}
                      fill="currentColor"
                      fontSize={12}
                      fontWeight={650}
                    >
                      {formatPnl(row?.pnl)}
                    </text>
                  </g>
                )
              }}
            />
            <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.25} />
            <Bar dataKey="pnl" radius={4} maxBarSize={88} isAnimationActive={false}>
              {exits.map((item) => (
                <Cell key={item.label} fill={item.fill} />
              ))}
              <LabelList dataKey="n" content={HitCountLabel} />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  )
}

export function SuggestionGrid({
  symbol,
  strategyId,
  lots,
  commission,
  chartTf,
  atrBar,
  atrPeriod,
  fillGroup,
  tpMult,
  slMult,
  range,
  onPick,
}: {
  symbol: string
  strategyId: string
  lots: number
  commission: number
  chartTf: number
  atrBar: number
  atrPeriod: number
  fillGroup: "signal" | "barClose"
  tpMult: number
  slMult: number
  range: { tpFrom: number; tpTo: number; slFrom: number; slTo: number } | null
  onPick: (tp: number, sl: number) => void
}) {
  const [pending, setPending] = useState<{ tp: number; sl: number; pnl: number } | null>(null)
  const atrBarLabel = ATR_BARS.find((bar) => Number(bar.value) === atrBar)?.label ?? `${atrBar} min`

  const gridQ = useQuery({
    queryKey: ["risk-reward-grid", symbol, strategyId, lots, commission, chartTf, atrBar, atrPeriod, range],
    queryFn: () =>
      api.riskRewardGrid({
        symbol,
        strategy_id: strategyId,
        lots,
        commission_per_lot: commission,
        chart_tf_minutes: chartTf,
        atr_bar_minutes: atrBar,
        atr_period: atrPeriod,
        tp_min: Math.min(range!.tpFrom, range!.tpTo),
        tp_max: Math.max(range!.tpFrom, range!.tpTo),
        sl_min: Math.min(range!.slFrom, range!.slTo),
        sl_max: Math.max(range!.slFrom, range!.slTo),
        step: 0.1,
      }),
    enabled: range !== null && Boolean(symbol && strategyId),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  })

  const data: RiskRewardGrid | undefined = gridQ.data
  const matrix =
    fillGroup === "barClose" && data?.bar_close ? data.bar_close : data?.signal
  const flat = (matrix ?? []).flat()
  const lo = flat.length ? Math.min(...flat) : 0
  const hi = flat.length ? Math.max(...flat) : 1
  const span = Math.max(hi - lo, 1)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {!range ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Press Build.
        </div>
      ) : gridQ.isFetching ? (
        <LoadingState title="Building the table" message="Checking each take-profit and stop pair…" />
      ) : gridQ.isError ? (
        <p className="text-sm text-destructive">{String(gridQ.error)}</p>
      ) : data && matrix ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted px-2 py-2 text-left font-medium">
                  <span className="text-emerald-700 dark:text-emerald-300">TP</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="text-rose-700 dark:text-rose-300">SL</span>
                </th>
                {data.sl.map((sl) => {
                  const activeSl = Math.abs(sl - slMult) < 0.001
                  return (
                    <th
                      key={sl}
                      className={cn(
                        "px-2 py-2 text-center font-mono text-[12px] font-medium",
                        activeSl
                          ? "bg-rose-200 text-rose-950 dark:bg-rose-900 dark:text-rose-50"
                          : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
                      )}
                    >
                      ×{sl.toFixed(1)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {data.tp.map((tp, rowIndex) => {
                const activeTp = Math.abs(tp - tpMult) < 0.001
                return (
                <tr key={tp} className="border-b border-border/60 last:border-0">
                  <th
                    className={cn(
                      "sticky left-0 z-10 px-2 py-1.5 text-left font-mono text-[12px] font-medium",
                      activeTp
                        ? "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50"
                        : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                    )}
                  >
                    ×{tp.toFixed(1)}
                  </th>
                  {data.sl.map((sl, colIndex) => {
                    const pnl = matrix[rowIndex]?.[colIndex] ?? 0
                    const rank = (pnl - lo) / span
                    const activeSl = Math.abs(sl - slMult) < 0.001
                    const selected = activeTp && activeSl
                    const wash = pnl >= 0
                      ? `rgba(16, 185, 129, ${0.05 + rank * 0.62})`
                      : `rgba(244, 63, 94, ${0.05 + (1 - rank) * 0.62})`
                    return (
                      <td key={sl} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => setPending({ tp, sl, pnl })}
                          className={cn(
                            "w-full rounded-sm px-1.5 py-2 text-center font-mono text-[13px] font-medium tabular-nums leading-none text-foreground",
                            "hover:ring-1 hover:ring-inset hover:ring-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
                            selected && "ring-1 ring-inset ring-amber-300",
                          )}
                          style={{ backgroundColor: wash }}
                        >
                          {formatPnl(pnl)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      </div>
      <Dialog open={pending != null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Use this take profit and stop?</DialogTitle>
            <DialogDescription>
              These levels are saved on Risk / Reward. Open that page and run to see the equity curve.
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="grid grid-cols-2 gap-2 py-2">
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">ATR bar</p>
                <p className="mt-1 font-mono text-sm">{atrBarLabel}</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">ATR length</p>
                <p className="mt-1 font-mono text-sm">{atrPeriod}</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Take profit</p>
                <p className="mt-1 font-mono text-sm">×{pending.tp.toFixed(1)}</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stop</p>
                <p className="mt-1 font-mono text-sm">×{pending.sl.toFixed(1)}</p>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-orange-600 text-white hover:bg-orange-600/90"
              onClick={() => {
                if (!pending) return
                const next = pending
                setPending(null)
                onPick(next.tp, next.sl)
              }}
            >
              Open Risk / Reward
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function levelsFor(trade: SimulateResponse["trades"][number]) {
  return [
    trade.tp_pnl_usd != null
      ? { y: trade.tp_pnl_usd, label: `TP hit ${formatPnl(trade.tp_pnl_usd)}`, color: "#22c55e" }
      : null,
    trade.sl_pnl_usd != null
      ? { y: trade.sl_pnl_usd, label: `SL hit ${formatPnl(trade.sl_pnl_usd)}`, color: "#ef4444" }
      : null,
  ].filter((level): level is { y: number; label: string; color: string } => level != null)
}

function csvExitMarker(path: { t: string; equity: number }[]) {
  const last = path[path.length - 1]
  if (!last) return undefined
  return [
    {
      t: last.t,
      y: last.equity,
      label: `CSV exit ${formatPnl(last.equity)}`,
      color: "#f59e0b",
    },
  ]
}

function EquityCurveGrid({
  rows,
  tradeEquity,
  timeZone,
}: {
  rows: SimulateResponse["trades"]
  tradeEquity: Record<string, { t: string; equity: number; drawdown: number }[]>
  timeZone: string
}) {
  const filled = rows.filter((row) => row.status === "ok" && row.net_pnl_usd != null)

  if (filled.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No filled trades to chart.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {filled.map((trade) => {
        const path = tradeEquity[String(trade.trade_id)] ?? []
        const reason = trade.exit_reason ?? "signal"
        const closed = EXIT_LABEL[reason] ?? reason
        return (
          <div key={trade.trade_id} className="rounded-md border bg-card p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  #{trade.trade_id}
                </span>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                    trade.side.toLowerCase() === "long"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                  )}
                >
                  {trade.side}
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", exitBadgeClass(reason))}>
                  {closed}
                </span>
              </div>
              <span
                className={cn(
                  "font-mono text-xs font-semibold tabular-nums",
                  pnlClass(trade.net_pnl_usd),
                )}
              >
                {formatPnl(trade.net_pnl_usd)}
              </span>
            </div>
            <DeferredTradeEquityChart
              equity={path}
              sessionBands={[]}
              timeZone={timeZone}
              domain={undefined}
              levels={levelsFor(trade)}
              markers={csvExitMarker(path)}
              guideLabels
              plain
              title={`Trade #${trade.trade_id}`}
              subtitle={closed}
            />
          </div>
        )
      })}
    </div>
  )
}

function RrTradesTable({
  rows,
  rawRows,
  tradeEquity,
  timeZone,
}: {
  rows: SimulateResponse["trades"]
  rawRows: SimulateResponse["trades"]
  tradeEquity: Record<string, { t: string; equity: number; drawdown: number }[]>
  timeZone: string
}) {
  const [zoomedId, setZoomedId] = useState<number | null>(null)
  const zoomed = rows.find((r) => r.trade_id === zoomedId) ?? null
  const zoomedPath = zoomedId != null ? (tradeEquity[String(zoomedId)] ?? []) : []
  const rawById = useMemo(() => {
    const map = new Map<number, SimulateResponse["trades"][number]>()
    for (const row of rawRows) map.set(row.trade_id, row)
    return map
  }, [rawRows])
  const zoomLevels = useMemo(() => (zoomed ? levelsFor(zoomed) : undefined), [zoomed])
  const zoomMarkers = useMemo(() => csvExitMarker(zoomedPath), [zoomedPath])
  const rowGrid =
    "grid grid-cols-[2.4rem_4.5rem_6.5rem_4.5rem_5.5rem_5.5rem_minmax(12rem,1fr)_5.5rem_5.5rem_2rem] items-center gap-x-3 px-3"

  return (
    <div className="min-w-0">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
        <p className="text-sm font-medium tracking-tight">ATR exits</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Each row is one CSV entry. The exit is the first of take-profit, stop, or the CSV close.
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[58rem]">
          <div
            className={cn(
              rowGrid,
              "sticky top-0 z-10 border-b border-border bg-muted/85 text-[9px] font-medium tracking-wider text-muted-foreground uppercase",
            )}
          >
            <span className="py-2.5">#</span>
            <span className="py-2.5">Dir</span>
            <span className="py-2.5">Exit</span>
            <span className="py-2.5 text-right">ATR</span>
            <span className="py-2.5 text-right">TP</span>
            <span className="py-2.5 text-right">SL</span>
            <span className="py-2.5">Open → close</span>
            <span className="py-2.5 text-right">ATR</span>
            <span className="py-2.5 text-right">Before</span>
            <span />
          </div>
          {rows.map((row, i) => {
            const isLong = row.side.toLowerCase() === "long"
            const reason = row.exit_reason ?? (row.status === "ok" ? "signal" : row.status)
            const rawNet = rawById.get(row.trade_id)?.net_pnl_usd
            return (
              <div
                key={row.trade_id}
                className={cn(
                  rowGrid,
                  "border-b border-border/40 py-2",
                  row.status !== "ok" && "opacity-45",
                  i % 2 === 1 && "bg-muted/10",
                )}
              >
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {row.trade_id}
                </span>
                <span
                  className={cn(
                    "w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                    isLong
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                  )}
                >
                  {row.side}
                </span>
                <span
                  className={cn(
                    "w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    exitBadgeClass(reason),
                  )}
                >
                  {EXIT_LABEL[reason ?? ""] ?? reason ?? "—"}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">{formatPx(row.atr)}</span>
                <span className="text-right font-mono text-[11px] tabular-nums">{formatPx(row.tp_price)}</span>
                <span className="text-right font-mono text-[11px] tabular-nums">{formatPx(row.sl_price)}</span>
                <span className="truncate font-mono text-[11px] tabular-nums">
                  {formatSimTime(row.fill_entry_time ?? row.open_time)}
                  <span className="mx-1 opacity-40">→</span>
                  {formatSimTime(row.fill_exit_time ?? row.close_time)}
                </span>
                <span className={cn("text-right font-mono text-[12px] font-semibold tabular-nums", pnlClass(row.net_pnl_usd))}>
                  {formatPnl(row.net_pnl_usd)}
                </span>
                <span className={cn("text-right font-mono text-[12px] tabular-nums", pnlClass(rawNet))}>
                  {formatPnl(rawNet)}
                </span>
                <button
                  type="button"
                  disabled={!tradeEquity[String(row.trade_id)]?.length}
                  onClick={() => setZoomedId(row.trade_id)}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  title="Trade equity"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <EquityCurveZoomModal
        open={zoomedId != null}
        onClose={() => setZoomedId(null)}
        equity={zoomedPath}
        timeZone={timeZone}
        sessionBands={buildSessionBands(zoomedPath, timeZone)}
        title={zoomed ? `Trade #${zoomed.trade_id}` : "Trade"}
        subtitle={
          zoomed
            ? `${EXIT_LABEL[zoomed.exit_reason ?? ""] ?? zoomed.exit_reason ?? "Exit"} · ATR ${formatPx(zoomed.atr)}`
            : undefined
        }
        levels={zoomLevels}
        markers={zoomMarkers}
      />
    </div>
  )
}
