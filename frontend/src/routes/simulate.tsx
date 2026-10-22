import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Activity,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Search,
  Settings2,
  ZoomIn,
} from "lucide-react"

import {
  EquityCurveZoomModal,
  PreciseEquityCurveChart,
  SessionLegend,
  type EquityPoint,
} from "@/components/charts"
import { LoadingState } from "@/components/loading-state"
import { SimOverviewPanel } from "@/components/sim-overview-panel"
import { api, type SimulateResponse, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { getSimulateSession, saveSimulateSession } from "@/lib/run-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  formatHumanDate,
  formatHumanDateDetail,
  formatMonthPeriod,
} from "@/lib/time"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/simulate")({
  component: SimulatePage,
})

type SymbolGroup = {
  symbol: string
  strategies: StrategyInfo[]
}

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Bucharest", label: "Bucharest" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
]

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

function formatCompact(n: number): string {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

function strategyKey(s: Pick<StrategyInfo, "symbol" | "strategy_id">): string {
  return `${s.symbol}::${s.strategy_id}`
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-foreground"
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400"
}

type DualSimResult = {
  signal: SimulateResponse
  barClose: SimulateResponse | null
  chartTf: number
}

function SimulatePage() {
  const saved = getSimulateSession()
  const { applied, selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [lots, setLots] = useState(saved.lots)
  const [commission, setCommission] = useState(saved.commission)
  const [balance, setBalance] = useState(saved.balance)
  const [chartTf, setChartTf] = useState(saved.chartTf)
  const [timeZone, setTimeZone] = useState(saved.timeZone)
  const [runKey, setRunKey] = useState(saved.runKey)
  /** Snapshot of inputs used for the last Run — typing does not re-fetch. */
  const [committed, setCommitted] = useState(saved.committed)
  const [activeTab, setActiveTab] = useState(saved.activeTab)
  /** Which fill group is shown when Chart TF > 0 (both sims are always run). */
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

  useEffect(() => {
    if (!query.trim()) return
    setExpanded((prev) => {
      const next = { ...prev }
      for (const g of groups) next[g.symbol] = true
      return next
    })
  }, [query, groups])

  // Only simulate after an explicit Run click — never on typing / focus / remount.
  // Always runs TF=0 (signal fills). When Chart TF > 0, also runs bar-close fills.
  // analysis_tz follows the selected Time zone so monthly/daily buckets match the UI.
  const simQ = useQuery({
    queryKey: ["simulate", committed, runKey, timeZone],
    queryFn: async (): Promise<DualSimResult> => {
      if (!committed) throw new Error("No run config")
      const base = {
        symbol: committed.symbol,
        strategy_id: committed.strategyId,
        lots: committed.lots,
        commission_per_lot: committed.commission,
        starting_balance: committed.balance,
        analysis_tz: timeZone,
      }
      if (committed.chartTf <= 0) {
        const signal = await api.simulate({ ...base, chart_tf_minutes: 0 })
        return { signal, barClose: null, chartTf: 0 }
      }
      const [signal, barClose] = await Promise.all([
        api.simulate({ ...base, chart_tf_minutes: 0 }),
        api.simulate({ ...base, chart_tf_minutes: committed.chartTf }),
      ])
      return { signal, barClose, chartTf: committed.chartTf }
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
    saveSimulateSession({
      lots,
      commission,
      balance,
      chartTf,
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
        committed.symbol !== applied.symbol ||
        committed.strategyId !== applied.strategyId),
  )

  const activeSim: SimulateResponse | null = useMemo(() => {
    if (!simQ.data) return null
    if (fillGroup === "barClose" && simQ.data.barClose) return simQ.data.barClose
    return simQ.data.signal
  }, [simQ.data, fillGroup])

  const summary = activeSim?.summary
  const startingBalance =
    activeSim?.settings?.starting_balance ?? balance

  const chartEquity = useMemo(() => {
    const rows = activeSim?.equity ?? []
    return rows.map((p) => ({
      t: p.t,
      equity: p.equity - startingBalance,
      drawdown: p.drawdown,
    }))
  }, [activeSim?.equity, startingBalance])

  const hasDualGroups = Boolean(simQ.data?.barClose)
  const signalPnl = simQ.data?.signal.summary?.sim_pnl_usd
  const barClosePnl = simQ.data?.barClose?.summary?.sim_pnl_usd

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

  function selectStrategy(s: StrategyInfo) {
    selectAndApply({ symbol: s.symbol, strategyId: s.strategy_id })
  }

  function runSim() {
    if (!applied.symbol || !applied.strategyId) return
    setCommitted({
      symbol: applied.symbol,
      strategyId: applied.strategyId,
      lots,
      commission,
      balance,
      chartTf,
    })
    setRunKey((k) => k + 1)
  }

  const loading = strategiesQ.isLoading
  const hasSelection = Boolean(applied.symbol && applied.strategyId)
  const hasRun = Boolean(committed && runKey > 0)

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
            {/* Strategy picker */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Strategy
              </p>
              <Dialog
                open={strategyPickerOpen}
                onOpenChange={setStrategyPickerOpen}
              >
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
                          {applied.strategyId || "Select a strategy"}
                        </p>
                      </div>
                      <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  }
                />
                <DialogContent className="max-h-[80vh] max-w-md overflow-hidden p-0">
                  <DialogHeader className="px-5 pt-5 pb-2">
                    <DialogTitle>Select strategy</DialogTitle>
                    <DialogDescription>
                      Choose a symbol and strategy to simulate.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="px-5 pb-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search symbol or strategy…"
                        className="h-9 bg-muted/40 pl-8"
                      />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                    {loading ? (
                      <LoadingState
                        className="py-8"
                        size="sm"
                        message="Loading strategies…"
                      />
                    ) : groups.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No matches.</p>
                    ) : (
                      <ul className="space-y-0.5">
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
                                className={cn(
                                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
                                  group.symbol === applied.symbol && "bg-muted/30",
                                )}
                              >
                                <ChevronDown
                                  className={cn(
                                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                    !open && "-rotate-90",
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold tracking-tight">
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
                                      <li key={strategyKey(s)}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            selectStrategy(s)
                                            setStrategyPickerOpen(false)
                                          }}
                                          className={cn(
                                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                            active
                                              ? "bg-rose-500/10 text-foreground ring-1 ring-rose-500/25"
                                              : "hover:bg-muted/50",
                                          )}
                                        >
                                          <span
                                            className={cn(
                                              "size-1.5 shrink-0 rounded-full",
                                              s.trade_count > 0
                                                ? "bg-emerald-500"
                                                : "bg-muted-foreground/30",
                                            )}
                                          />
                                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                            {s.strategy_id}
                                          </span>
                                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
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

            {/* Settings */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Settings
              </p>
              <Field
                label="Lots"
                value={lots}
                onChange={setLots}
                step={0.01}
                min={0.01}
                className="w-full"
              />
              <Field
                label="Commission / lot"
                value={commission}
                onChange={setCommission}
                step={0.1}
                min={0}
                className="w-full"
              />
              <Field
                label="Balance"
                value={balance}
                onChange={setBalance}
                step={100}
                min={100}
                className="w-full"
              />
              <Field
                label="Chart TF (min)"
                value={chartTf}
                onChange={setChartTf}
                step={1}
                min={0}
                className="w-full"
              />
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Time zone
                </label>
                <Select
                  value={timeZone}
                  onValueChange={(v) => v && setTimeZone(v)}
                >
                  <SelectTrigger size="sm" className="h-9 w-full text-[12px]">
                    <SelectValue placeholder="Time zone">
                      {TIMEZONES.find((t) => t.value === timeZone)?.label ??
                        timeZone}
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
              className="mt-1 gap-1.5 bg-rose-600 text-white hover:bg-rose-600/90"
              disabled={!hasSelection || simQ.isFetching}
              onClick={runSim}
            >
              {simQ.isFetching ? (
                <Spinner className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run
            </Button>

            <div className="mt-auto">
              {hasRun && activeSim?.meta?.rule ? (
                <p className="text-[11px] text-muted-foreground">
                  {activeSim.meta.rule}
                  {settingsDirty ? (
                    <span className="mt-0.5 block text-amber-600 dark:text-amber-400">
                      Settings changed — click Run to re-simulate
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {hasSelection
                    ? `Ready · ${applied.symbol} / ${applied.strategyId}`
                    : "Pick a symbol and strategy, then click Run"}
                </p>
              )}
            </div>
          </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 overflow-hidden border-b border-border px-3 transition-[max-height,opacity,padding] duration-200 ease-linear",
              sidebarOpen
                ? "max-h-0 opacity-0 py-0"
                : "max-h-10 opacity-100 py-1.5",
            )}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title="Show sidebar"
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-3.5" />
              Setup
            </button>
            {hasSelection ? (
              <span className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">
                  {applied.symbol}
                </span>
                <span className="mx-1">/</span>
                {applied.strategyId}
              </span>
            ) : null}
          </div>
          {!hasSelection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Activity className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Choose what to simulate</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Select a symbol and strategy from the left, set lots / TF if
                needed, then press Run.
              </p>
            </div>
          ) : !hasRun ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Play className="size-8 text-rose-500/50" />
              <p className="text-sm font-medium">
                {applied.symbol}{" "}
                <span className="text-muted-foreground">/</span>{" "}
                {applied.strategyId}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Nothing has been simulated yet. Use{" "}
                <span className="font-medium text-foreground">Run</span> in the
                toolbar when you are ready.
              </p>
            </div>
          ) : simQ.isFetching ? (
            <LoadingState
              title="Simulating"
              message={
                committed && committed.chartTf > 0
                  ? `Building signal-time and ${committed.chartTf}m bar-close results for ${applied.symbol} / ${applied.strategyId}…`
                  : `Replaying ${applied.symbol} / ${applied.strategyId} on tick fills…`
              }
            />
          ) : simQ.isError ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <p className="text-sm text-destructive">{String(simQ.error)}</p>
            </div>
          ) : activeSim && summary ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Compact results header (~20% vertical budget) */}
              <div className="shrink-0 border-b border-border px-3 py-2">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold tracking-tight">
                        {applied.symbol}
                      </span>
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[9px] text-rose-700 dark:text-rose-300"
                      >
                        {applied.strategyId}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        · {fillModeLabel}
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
                        <span className="mx-1.5 font-normal text-muted-foreground">
                          →
                        </span>
                        {formatHumanDate(periodTo, timeZone)}
                        <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
                          {formatHumanDateDetail(periodFrom, timeZone)}
                          <span className="mx-1">→</span>
                          {formatHumanDateDetail(periodTo, timeZone)}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {hasDualGroups ? (
                    <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:w-[22rem]">
                      <FillGroupCard
                        active={fillGroup === "signal"}
                        title="At signal"
                        tfLabel="0m"
                        pnl={signalPnl}
                        onClick={() => setFillGroup("signal")}
                      />
                      <FillGroupCard
                        active={fillGroup === "barClose"}
                        title="Bar close"
                        tfLabel={`${simQ.data?.chartTf ?? chartTf}m`}
                        pnl={barClosePnl}
                        onClick={() => setFillGroup("barClose")}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Section tabs */}
              <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "analytics", label: "Analytics" },
                  { id: "trades", label: "Trades" },
                  { id: "grid", label: "Equity by trade" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={cn(
                      "relative shrink-0 px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors",
                      activeTab === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {activeTab === tab.id ? (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-rose-500" />
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeTab === "overview" ? (
                  <SimOverviewPanel
                    summary={summary}
                    equity={chartEquity}
                    trades={activeSim.trades}
                    timeZone={timeZone}
                  />
                ) : activeTab === "analytics" ? (
                  <SimAnalyticsPanel
                    summary={summary}
                    trades={activeSim.trades}
                    equity={chartEquity}
                    timeZone={timeZone}
                  />
                ) : activeTab === "trades" ? (
                  <div className="flex min-h-[24rem] flex-1 flex-col pb-10">
                    <div className="sticky top-0 z-10 flex shrink-0 items-end justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
                      <div>
                        <p className="text-sm font-medium tracking-tight">
                          Simulated trades
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {summary.filled} filled · {summary.skipped} skipped
                        </p>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1">
                      <SimTradesTable
                        rows={activeSim.trades}
                        tradeEquity={activeSim.trade_equity ?? {}}
                        timeZone={timeZone}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <SessionLegend timeZone={timeZone} />
                    <div className="min-h-0 flex-1">
                      <TradeWiseGrid
                        tradeEquity={activeSim.trade_equity ?? {}}
                        trades={activeSim.trades}
                        timeZone={timeZone}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  step,
  min,
  className,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
  min: number
  className?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <Input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-9 w-[6.5rem] font-mono text-[12px]",
          className,
        )}
      />
    </label>
  )
}

function FillGroupCard({
  active,
  title,
  tfLabel,
  pnl,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  pnl: number | null | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-md border px-2 py-1.5 text-left transition-all",
        active
          ? "border-rose-500/50 bg-rose-500/[0.08] ring-1 ring-rose-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[10px] font-medium text-muted-foreground">
          {title}
          <span className="ml-1 font-mono tabular-nums">· {tfLabel}</span>
        </span>
        {active ? (
          <span className="shrink-0 rounded bg-rose-600/90 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-white">
            On
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold tabular-nums",
          pnlClass(pnl),
        )}
      >
        {formatPnl(pnl)}
      </p>
    </button>
  )
}

function msToLocalYmd(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone })
}

function getTimezoneOffsetMs(ms: number, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName")?.value
  if (!part) return 0
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!m) return 0
  const sign = m[1] === "+" ? 1 : -1
  const hours = Number(m[2])
  const mins = Number(m[3])
  return sign * (hours * 60 + mins) * 60 * 1000
}

function localYmdToMs(ymd: string, hour: number, timeZone: string): number {
  const [y, m, d] = ymd.split("-").map(Number)
  const naive = Date.UTC(y, m - 1, d, hour, 0, 0, 0)
  // Find the UTC instant whose local time in the target TZ equals ymd + hour.
  let ms = naive - getTimezoneOffsetMs(naive, timeZone)
  for (let i = 0; i < 3; i++) {
    const offset = getTimezoneOffsetMs(ms, timeZone)
    const next = naive - offset
    if (Math.abs(next - ms) < 1000) return next
    ms = next
  }
  return ms
}

/** Return the local calendar-day domain (midnight → next midnight) for the first equity point. */
export function getDayDomain(
  equity: { t: string }[],
  timeZone: string,
): [number, number] | undefined {
  if (equity.length === 0) return undefined
  const firstMs = Date.parse(equity[0].t)
  if (Number.isNaN(firstMs)) return undefined

  const localYmd = msToLocalYmd(firstMs, timeZone)
  const [y, m, d] = localYmd.split("-").map(Number)
  const nextDate = new Date(Date.UTC(y, m - 1, d + 1))
  const nextYmd = nextDate.toISOString().slice(0, 10)

  return [
    localYmdToMs(localYmd, 0, timeZone),
    localYmdToMs(nextYmd, 0, timeZone),
  ]
}

/**
 * Session bands for one local calendar day (midnight → midnight),
 * derived from UTC session windows and clipped to the local day.
 *
 * Paint uses non-overlapping splits at Tokyo close / London-NY window:
 *   Asia:        22:00→09:00 UTC
 *   Europe + US: 09:00→22:00 UTC  (London open 08:00 is shown in the legend)
 */
function buildSessionBandsForDay(
  ymd: string,
  timeZone: string,
): import("@/components/charts/signed-area-curve-chart").SessionBand[] {
  const dayStart = localYmdToMs(ymd, 0, timeZone)
  const [y, m, d] = ymd.split("-").map(Number)
  const nextYmd = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const dayEnd = localYmdToMs(nextYmd, 0, timeZone)

  // Walk a few UTC days that can overlap this local day.
  const probe = new Date(dayStart - 12 * 60 * 60 * 1000)
  const bands: import("@/components/charts/signed-area-curve-chart").SessionBand[] =
    []

  for (let i = 0; i < 3; i++) {
    const utcY = probe.getUTCFullYear()
    const utcM = probe.getUTCMonth()
    const utcD = probe.getUTCDate() + i

    // Asia 22:00 UTC → 09:00 UTC next day
    const asiaStart = Date.UTC(utcY, utcM, utcD, 22, 0, 0)
    const asiaEnd = Date.UTC(utcY, utcM, utcD + 1, 9, 0, 0)
    const asiaClipStart = Math.max(asiaStart, dayStart)
    const asiaClipEnd = Math.min(asiaEnd, dayEnd)
    if (asiaClipEnd > asiaClipStart) {
      bands.push({
        start: asiaClipStart,
        end: asiaClipEnd,
        label: "Asia (Sydney + Tokyo)",
        color: "#818cf8",
      })
    }

    // Europe+US paint: 09:00→22:00 UTC (no overlap with Asia paint)
    const euStart = Date.UTC(utcY, utcM, utcD, 9, 0, 0)
    const euEnd = Date.UTC(utcY, utcM, utcD, 22, 0, 0)
    const euClipStart = Math.max(euStart, dayStart)
    const euClipEnd = Math.min(euEnd, dayEnd)
    if (euClipEnd > euClipStart) {
      bands.push({
        start: euClipStart,
        end: euClipEnd,
        label: "Europe + US (London + NY)",
        color: "#34d399",
      })
    }
  }

  return bands
}

/** Build session bands covering the calendar day of the first equity point. */
export function buildSessionBands(
  equity: { t: string }[],
  timeZone: string,
): import("@/components/charts/signed-area-curve-chart").SessionBand[] {
  if (equity.length === 0) return []
  const firstMs = Date.parse(equity[0].t)
  if (Number.isNaN(firstMs)) return []
  return buildSessionBandsForDay(msToLocalYmd(firstMs, timeZone), timeZone)
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—"
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatSimTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const cleaned = iso.replace("T", " ").replace("Z", "")
  const m = cleaned.match(/(\d{4}-)?(\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  if (!m) return cleaned.slice(0, 16)
  return `${m[2]} ${m[3]}`
}

function AnalyticsKpi({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string
  value: string
  sub?: string
  tone?: "up" | "down" | "neutral"
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/80 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-[15px] font-semibold tracking-tight tabular-nums",
          tone === "up" && "text-emerald-600 dark:text-emerald-400",
          tone === "down" && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function AnalyticsSection({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-card/60 p-4",
        className,
      )}
    >
      <h3 className="mb-3 text-[13px] font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

export function SimAnalyticsPanel({
  summary,
  trades,
  equity,
  timeZone,
}: {
  summary: NonNullable<Awaited<ReturnType<typeof api.simulate>>["summary"]>
  trades: NonNullable<Awaited<ReturnType<typeof api.simulate>>["trades"]>
  equity: EquityPoint[]
  timeZone: string
}) {
  const a = summary.analytics
  if (!a) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Analytics not available for this result.
        </p>
      </div>
    )
  }

  const commission = trades.reduce(
    (sum, t) => sum + (t.commission_usd ?? 0),
    0,
  )

  // Account MFE / MAE from starting balance (equity series is already PnL).
  let accountMfe = 0
  let accountMfeTime: string | null = null
  let accountMae = 0
  let accountMaeTime: string | null = null
  for (const p of equity) {
    if (p.equity > accountMfe) {
      accountMfe = p.equity
      accountMfeTime = p.t
    }
    if (p.equity < accountMae) {
      accountMae = p.equity
      accountMaeTime = p.t
    }
  }
  const pfLabel =
    summary.profit_factor == null
      ? "∞"
      : summary.profit_factor.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })

  const longA = a.by_side.long
  const shortA = a.by_side.short
  const longS = summary.by_side?.long
  const shortS = summary.by_side?.short

  const sessionRows = [
    {
      key: "sydney_tokyo",
      label: "Asia",
      detail: "Sydney + Tokyo",
      pnl: a.session_pnls.sydney_tokyo ?? 0,
      color: "#818cf8",
    },
    {
      key: "london_newyork",
      label: "Europe + US",
      detail: "London + New York",
      pnl: a.session_pnls.london_newyork ?? 0,
      color: "#34d399",
    },
  ]
  const sessionMax = Math.max(...sessionRows.map((r) => Math.abs(r.pnl)), 1)
  const monthlyMax = Math.max(
    ...a.monthly_pnls.map((m) => Math.abs(m.pnl_usd)),
    1,
  )

  const durationRows = [
    {
      label: "Win",
      shortest: a.shortest_win_ms,
      average: a.avg_win_duration_ms,
      tone: "up" as const,
    },
    {
      label: "Loss",
      shortest: a.shortest_loss_ms,
      average: a.avg_loss_duration_ms,
      tone: "down" as const,
    },
  ]

  return (
    <div className="space-y-5 p-4 pb-8">
      {/* 1. Summary KPIs */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Summary
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <AnalyticsKpi
            label="Avg / trade"
            value={`$${formatUsd(a.avg_pnl_usd)}`}
            tone={
              a.avg_pnl_usd > 0 ? "up" : a.avg_pnl_usd < 0 ? "down" : "neutral"
            }
          />
          <AnalyticsKpi
            label="Avg win"
            value={`$${formatUsd(a.avg_win_usd)}`}
            sub={`${summary.wins} wins`}
            tone="up"
          />
          <AnalyticsKpi
            label="Avg loss"
            value={`$${formatUsd(a.avg_loss_usd)}`}
            sub={`${summary.losses} losses`}
            tone="down"
          />
          <AnalyticsKpi
            label="Best"
            value={formatPnl(a.best_trade?.pnl_usd)}
            sub={a.best_trade ? `Trade #${a.best_trade.trade_id}` : undefined}
            tone="up"
          />
          <AnalyticsKpi
            label="Worst"
            value={formatPnl(a.worst_trade?.pnl_usd)}
            sub={
              a.worst_trade ? `Trade #${a.worst_trade.trade_id}` : undefined
            }
            tone="down"
          />
          <AnalyticsKpi
            label="Max streak"
            value={`${a.max_consecutive_wins}W / ${a.max_consecutive_losses}L`}
          />
        </div>
      </div>

      {/* 2. Performance */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Performance
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <AnalyticsKpi
            label="Total PnL"
            value={formatPnl(summary.sim_pnl_usd)}
            sub={`${formatPnl(summary.return_pct)}% return`}
            tone={
              summary.sim_pnl_usd > 0
                ? "up"
                : summary.sim_pnl_usd < 0
                  ? "down"
                  : "neutral"
            }
          />
          <AnalyticsKpi
            label="Win rate"
            value={`${(summary.win_rate * 100).toFixed(1)}%`}
            sub={`${summary.wins}W / ${summary.losses}L`}
            tone={summary.win_rate >= 0.5 ? "up" : "down"}
          />
          <AnalyticsKpi label="Profit factor" value={pfLabel} />
          <AnalyticsKpi
            label="MFE"
            value={`$${formatUsd(accountMfe)}`}
            sub={
              formatHumanDateDetail(accountMfeTime, timeZone) ??
              "max favorable from start"
            }
            tone="up"
          />
          <AnalyticsKpi
            label="MAE"
            value={formatPnl(accountMae)}
            sub={
              formatHumanDateDetail(accountMaeTime, timeZone) ??
              "max adverse from start"
            }
            tone="down"
          />
          <AnalyticsKpi
            label="Commission"
            value={`$${formatUsd(commission)}`}
            sub="round-trip total"
          />
          <AnalyticsKpi
            label="Trades"
            value={`${summary.filled}`}
            sub={`${summary.skipped} skipped`}
          />
          <AnalyticsKpi
            label="vs TradingView"
            value={formatPnl(summary.pnl_diff_usd)}
            sub={`TV ${formatPnl(summary.tv_pnl_usd)}`}
            tone={
              summary.pnl_diff_usd > 0
                ? "up"
                : summary.pnl_diff_usd < 0
                  ? "down"
                  : "neutral"
            }
          />
        </div>
      </div>

      {/* 3. Long vs Short */}
      <AnalyticsSection title="Long vs Short">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                key: "long",
                title: "Long",
                accent: "text-emerald-700 dark:text-emerald-400",
                ring: "border-emerald-500/20 bg-emerald-500/[0.05]",
                avg: longA?.avg_pnl_usd,
                best: longA?.biggest_win_usd,
                worst: longA?.biggest_loss_usd,
                filled: longS?.filled,
                pnl: longS?.pnl_usd,
                winRate: longS?.win_rate,
                pf: longS?.profit_factor,
              },
              {
                key: "short",
                title: "Short",
                accent: "text-rose-700 dark:text-rose-400",
                ring: "border-rose-500/20 bg-rose-500/[0.05]",
                avg: shortA?.avg_pnl_usd,
                best: shortA?.biggest_win_usd,
                worst: shortA?.biggest_loss_usd,
                filled: shortS?.filled,
                pnl: shortS?.pnl_usd,
                winRate: shortS?.win_rate,
                pf: shortS?.profit_factor,
              },
            ] as const
          ).map((side) => (
            <div
              key={side.key}
              className={cn("rounded-lg border px-3 py-3", side.ring)}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={cn("text-[13px] font-semibold", side.accent)}>
                  {side.title}
                </p>
                {side.filled != null ? (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {side.filled} trades
                    {side.winRate != null
                      ? ` · ${(side.winRate * 100).toFixed(0)}% WR`
                      : ""}
                  </span>
                ) : null}
              </div>
              {side.pnl != null ? (
                <p
                  className={cn(
                    "mt-1.5 font-mono text-lg font-semibold tabular-nums",
                    pnlClass(side.pnl),
                  )}
                >
                  {formatPnl(side.pnl)}
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <span className="text-muted-foreground">Average</span>
                <span className="text-right font-mono tabular-nums">
                  ${formatUsd(side.avg)}
                </span>
                <span className="text-muted-foreground">Best</span>
                <span className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatPnl(side.best)}
                </span>
                <span className="text-muted-foreground">Worst</span>
                <span className="text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  {formatPnl(side.worst)}
                </span>
                <span className="text-muted-foreground">Profit factor</span>
                <span className="text-right font-mono tabular-nums">
                  {side.pf == null
                    ? "∞"
                    : side.pf.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </AnalyticsSection>

      {/* 4. Sessions + 5. Duration */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AnalyticsSection title="Session PnL">
          <div className="space-y-4">
            {sessionRows.map((row) => (
              <div key={row.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-medium">{row.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {row.detail}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      pnlClass(row.pnl),
                    )}
                  >
                    {formatPnl(row.pnl)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${(Math.abs(row.pnl) / sessionMax) * 100}%`,
                      backgroundColor: row.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </AnalyticsSection>

        <AnalyticsSection title="Duration">
          <div className="grid grid-cols-2 gap-3">
            {durationRows.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  row.tone === "up"
                    ? "border-emerald-500/20 bg-emerald-500/[0.05]"
                    : "border-rose-500/20 bg-rose-500/[0.05]",
                )}
              >
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    row.tone === "up"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-700 dark:text-rose-400",
                  )}
                >
                  {row.label}
                </p>
                <div className="mt-2 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Shortest
                    </span>
                    <span className="font-mono text-[12px] font-semibold tabular-nums">
                      {formatDuration(row.shortest)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Average
                    </span>
                    <span className="font-mono text-[12px] font-semibold tabular-nums">
                      {formatDuration(row.average)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AnalyticsSection>
      </div>

      {/* 6. Monthly */}
      <AnalyticsSection title="Monthly PnL">
        {a.monthly_pnls.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No monthly data
          </p>
        ) : (
          <div className="space-y-2.5">
            {a.monthly_pnls.map((m) => {
              const pct =
                monthlyMax > 0 ? (Math.abs(m.pnl_usd) / monthlyMax) * 100 : 0
              return (
                <div
                  key={m.period}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                >
                  <div className="w-[6.75rem] shrink-0">
                    <p className="truncate text-[12px] font-medium leading-tight">
                      {formatMonthPeriod(m.period, "short")}
                    </p>
                    <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {m.wins}W
                      </span>
                      <span className="mx-1 opacity-40">·</span>
                      <span className="text-rose-600 dark:text-rose-400">
                        {m.losses}L
                      </span>
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          m.pnl_usd >= 0 ? "bg-emerald-500" : "bg-rose-500",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className={cn(
                      "w-[4.75rem] shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums",
                      pnlClass(m.pnl_usd),
                    )}
                  >
                    {formatPnl(m.pnl_usd)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </AnalyticsSection>
    </div>
  )
}

/** Keep a top-layer spinner until Recharts has a real SVG size (was painting blank). */
export function DeferredTradeEquityChart({
  equity,
  sessionBands,
  timeZone,
  domain,
  levels,
  markers,
  guideLabels = true,
  plain = false,
  title,
  subtitle,
}: {
  equity: EquityPoint[]
  sessionBands: import("@/components/charts/signed-area-curve-chart").SessionBand[]
  timeZone: string
  domain: [number, number] | undefined
  levels?: { y: number; label: string; color: string }[]
  markers?: { t: string; y: number; label: string; color: string }[]
  guideLabels?: boolean
  plain?: boolean
  title?: string
  subtitle?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [chartReady, setChartReady] = useState(false)

  useEffect(() => {
    setChartReady(false)
    if (equity.length === 0) {
      setChartReady(true)
      return
    }

    const el = hostRef.current
    if (!el) return

    let settled = false
    const markReady = () => {
      if (settled) return
      const svg = el.querySelector(".recharts-surface") as SVGElement | null
      const w = svg?.clientWidth ?? 0
      const h = svg?.clientHeight ?? 0
      if (w > 16 && h > 16) {
        settled = true
        // Brief pause so the spinner is actually visible
        window.setTimeout(() => setChartReady(true), 120)
      }
    }

    const ro = new ResizeObserver(() => markReady())
    ro.observe(el)
    const poll = window.setInterval(markReady, 50)
    const fallback = window.setTimeout(() => setChartReady(true), 3000)

    return () => {
      settled = true
      ro.disconnect()
      window.clearInterval(poll)
      window.clearTimeout(fallback)
    }
  }, [equity])

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative h-28 w-full min-h-[7rem] overflow-hidden rounded-md",
        plain ? "bg-transparent" : "bg-muted/15",
      )}
    >
      {equity.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          No path
        </div>
      ) : (
        <PreciseEquityCurveChart
          equity={equity}
          className="h-full min-h-[7rem] w-full"
          emptyMessage="No path"
          sessionBands={sessionBands}
          timeZone={timeZone}
          domain={domain}
          levels={levels}
          markers={markers}
          guideLabels={guideLabels}
          title={title}
          subtitle={subtitle}
        />
      )}

      {!chartReady ? (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80"
          aria-busy
          aria-label="Loading chart"
        >
          <Spinner className="size-5 text-rose-500" />
        </div>
      ) : null}
    </div>
  )
}

function TradeWiseGrid({
  tradeEquity,
  trades,
  timeZone = "Europe/Bucharest",
}: {
  tradeEquity: Record<string, EquityPoint[]>
  trades: NonNullable<Awaited<ReturnType<typeof api.simulate>>["trades"]>
  timeZone?: string
}) {
  const filled = trades.filter((t) => t.status === "ok" && t.net_pnl_usd != null)
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
        const bands = buildSessionBands(path, timeZone)
        const domain = getDayDomain(path, timeZone)
        return (
          <div
            key={trade.trade_id}
            className="rounded-md border bg-card p-2"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
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
              sessionBands={bands}
              timeZone={timeZone}
              domain={domain}
            />
          </div>
        )
      })}
    </div>
  )
}

export function SimTradesTable({
  rows,
  tradeEquity,
  timeZone,
  showSymbol = false,
}: {
  rows: NonNullable<
    Awaited<ReturnType<typeof api.simulate>>
  >["trades"]
  tradeEquity: Record<string, EquityPoint[]>
  timeZone: string
  showSymbol?: boolean
}) {
  const [zoomedId, setZoomedId] = useState<number | null>(null)
  const zoomedRow = useMemo(
    () => rows.find((r) => r.trade_id === zoomedId) ?? null,
    [rows, zoomedId],
  )
  const zoomedPath = useMemo(
    () => (zoomedId != null ? tradeEquity[String(zoomedId)] ?? [] : []),
    [tradeEquity, zoomedId],
  )
  const zoomedDomain = useMemo(
    () => getDayDomain(zoomedPath, timeZone),
    [zoomedPath, timeZone],
  )
  /**
   * Compare-first column order:
   * identity → times (TV vs Sim stacked) → fills/slip/excursion → PnL trio (TV | Sim | Δ) → zoom
   */
  const rowGrid = cn(
    "grid items-center gap-x-3 px-3",
    showSymbol
      ? "grid-cols-[4.75rem_2.75rem_2.5rem_3.5rem_minmax(11rem,1.15fr)_4rem_4rem_3.25rem_3.25rem_4rem_4rem_minmax(13rem,0.95fr)_2rem]"
      : "grid-cols-[2.5rem_3.5rem_minmax(11rem,1.15fr)_4rem_4rem_3.25rem_3.25rem_4rem_4rem_minmax(13rem,0.95fr)_2rem]",
  )

  if (rows.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
        No trades.
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          rowGrid,
          "sticky top-0 z-10 border-b border-border bg-muted/85 text-[9px] font-medium tracking-wider text-muted-foreground uppercase backdrop-blur-sm",
        )}
      >
        <span className="py-2.5">#</span>
        {showSymbol ? (
          <>
            <span className="py-2.5">Symbol</span>
            <span className="py-2.5">Strategy</span>
          </>
        ) : null}
        <span className="py-2.5">Dir</span>
        <span className="py-2.5">Open → close</span>
        <span className="py-2.5 text-right">Fill in</span>
        <span className="py-2.5 text-right">Fill out</span>
        <span className="py-2.5 text-right">Slip in</span>
        <span className="py-2.5 text-right">Slip out</span>
        <span className="py-2.5 text-right">MFE</span>
        <span className="py-2.5 text-right">MAE</span>
        <span className="py-2.5 text-right">PnL compare</span>
        <span className="py-2.5 text-right" />
      </div>

      {rows.map((row, i) => {
        const disabled = row.status !== "ok" || row.net_pnl_usd == null
        const isLong = row.side.toLowerCase() === "long"
        const diff =
          row.net_pnl_usd != null && row.tv_pnl_usd != null
            ? row.net_pnl_usd - row.tv_pnl_usd
            : null
        const hasPath = Boolean(tradeEquity[String(row.trade_id)]?.length)
        return (
          <div
            key={row.trade_id}
            className={cn(
              rowGrid,
              "w-full border-b border-border/40 py-2 text-left",
              disabled && "opacity-45",
              i % 2 === 1 && "bg-muted/10",
            )}
          >
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.trade_id}
            </span>
            {showSymbol ? (
              <>
                <span className="truncate font-mono text-[11px] font-semibold">
                  {row.symbol ?? "—"}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {row.strategy_id ?? "—"}
                </span>
              </>
            ) : null}
            <span
              className={cn(
                "inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                isLong
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              )}
            >
              {row.side}
            </span>

            {/* Times stacked: TV (original) above Sim — easy eye scan */}
            <div className="min-w-0 space-y-0.5 font-mono text-[11px] tabular-nums leading-tight">
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="w-7 shrink-0 text-[8px] font-semibold tracking-wide text-violet-600 uppercase dark:text-violet-400">
                  TV
                </span>
                <span className="truncate">
                  {formatSimTime(row.open_time)}
                  <span className="mx-0.5 opacity-40">→</span>
                  {formatSimTime(row.close_time)}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                <span className="w-7 shrink-0 text-[8px] font-semibold tracking-wide text-rose-600 uppercase dark:text-rose-400">
                  Sim
                </span>
                <span className="truncate font-medium">
                  {formatSimTime(row.fill_entry_time)}
                  <span className="mx-0.5 opacity-40">→</span>
                  {formatSimTime(row.fill_exit_time)}
                </span>
              </div>
            </div>

            <span className="text-right font-mono text-[11px] tabular-nums">
              {row.fill_entry_price ?? "—"}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums">
              {row.fill_exit_price ?? "—"}
            </span>
            <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {row.entry_slip_pips ?? "—"}
            </span>
            <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {row.exit_slip_pips ?? "—"}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] tabular-nums",
                pnlClass(row.max_runup_usd),
              )}
            >
              {formatPnl(row.max_runup_usd)}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] tabular-nums",
                pnlClass(row.max_drawdown_usd),
              )}
            >
              {formatPnl(row.max_drawdown_usd)}
            </span>

            {/* PnL compare block — the thing you actually want to eyeball */}
            <div className="rounded-md border border-border/60 bg-muted/25 px-2 py-1">
              <div className="grid grid-cols-3 gap-1 text-right">
                <div>
                  <div className="text-[8px] font-semibold tracking-wide text-violet-600 uppercase dark:text-violet-400">
                    TV
                  </div>
                  <div
                    className={cn(
                      "font-mono text-[12px] tabular-nums",
                      pnlClass(row.tv_pnl_usd),
                    )}
                  >
                    {formatPnl(row.tv_pnl_usd)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-semibold tracking-wide text-rose-600 uppercase dark:text-rose-400">
                    Sim
                  </div>
                  <div
                    className={cn(
                      "font-mono text-[12px] font-semibold tabular-nums",
                      pnlClass(row.net_pnl_usd),
                    )}
                  >
                    {formatPnl(row.net_pnl_usd)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Δ
                  </div>
                  <div
                    className={cn(
                      "font-mono text-[12px] font-medium tabular-nums",
                      pnlClass(diff),
                    )}
                  >
                    {formatPnl(diff)}
                  </div>
                </div>
              </div>
            </div>

            {/* Row-level zoom into trade equity curve */}
            <span className="flex justify-end">
              {hasPath ? (
                <button
                  type="button"
                  onClick={() => setZoomedId(row.trade_id)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Show equity curve"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              ) : null}
            </span>
          </div>
        )
      })}

      <EquityCurveZoomModal
        open={zoomedRow != null}
        onClose={() => setZoomedId(null)}
        equity={zoomedPath}
        emptyMessage="No tick path for this trade"
        sessionBands={buildSessionBands(zoomedPath, timeZone)}
        timeZone={timeZone}
        domain={zoomedDomain}
        title={
          zoomedRow
            ? `Trade #${zoomedRow.trade_id} · ${zoomedRow.side}`
            : "Equity curve"
        }
        subtitle={
          zoomedRow
            ? `${formatSimTime(zoomedRow.fill_entry_time)} → ${formatSimTime(zoomedRow.fill_exit_time)}`
            : undefined
        }
      />
    </>
  )
}
