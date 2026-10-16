import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  ChevronDown,
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
import { api, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
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

function SimulatePage() {
  const { applied, selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [lots, setLots] = useState(0.1)
  const [commission, setCommission] = useState(7)
  const [balance, setBalance] = useState(2000)
  const [chartTf, setChartTf] = useState(10)
  const [timeZone, setTimeZone] = useState("Europe/Bucharest")
  const [runKey, setRunKey] = useState(0)
  /** Snapshot of inputs used for the last Run — typing does not re-fetch. */
  const [committed, setCommitted] = useState<{
    symbol: string
    strategyId: string
    lots: number
    commission: number
    balance: number
    chartTf: number
  } | null>(null)
  const [activeTab, setActiveTab] = useState<
    "overview" | "analytics" | "trades" | "grid"
  >("overview")
  const [strategyPickerOpen, setStrategyPickerOpen] = useState(false)

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
  const simQ = useQuery({
    queryKey: ["simulate", committed, runKey],
    queryFn: () => {
      if (!committed) throw new Error("No run config")
      return api.simulate({
        symbol: committed.symbol,
        strategy_id: committed.strategyId,
        lots: committed.lots,
        commission_per_lot: committed.commission,
        starting_balance: committed.balance,
        chart_tf_minutes: committed.chartTf,
      })
    },
    enabled: Boolean(committed && runKey > 0),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    setRunKey(0)
    setCommitted(null)
  }, [applied.symbol, applied.strategyId])

  const settingsDirty = Boolean(
    committed &&
      (committed.lots !== lots ||
        committed.commission !== commission ||
        committed.balance !== balance ||
        committed.chartTf !== chartTf ||
        committed.symbol !== applied.symbol ||
        committed.strategyId !== applied.strategyId),
  )

  const summary = simQ.data?.summary
  const startingBalance =
    simQ.data?.settings?.starting_balance ?? balance

  const chartEquity = useMemo(() => {
    const rows = simQ.data?.equity ?? []
    return rows.map((p) => ({
      t: p.t,
      equity: p.equity - startingBalance,
      drawdown: p.drawdown,
    }))
  }, [simQ.data?.equity, startingBalance])

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
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background/60 lg:grid-cols-[16rem_minmax(0,1fr)]">

        <aside className="flex min-h-0 flex-col border-b border-border bg-muted/20 lg:border-r lg:border-b-0">
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
              {hasRun && simQ.data?.meta?.rule ? (
                <p className="text-[11px] text-muted-foreground">
                  {simQ.data.meta.rule}
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
        </aside>

        <section className="flex min-h-0 flex-col">
          {hasSelection ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">
                  {applied.symbol}
                </span>
                <Badge
                  variant="secondary"
                  className="h-5 text-[10px] text-rose-700 dark:text-rose-300"
                >
                  {applied.strategyId}
                </Badge>
              </div>
              {settingsDirty ? (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  Settings changed — click Run to re-simulate
                </span>
              ) : null}
            </div>
          ) : null}

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
              message={`Replaying ${applied.symbol} / ${applied.strategyId} on tick fills…`}
            />
          ) : simQ.isError ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <p className="text-sm text-destructive">
                    {String(simQ.error)}
                  </p>
                </div>
              ) : simQ.data && summary ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex shrink-0 border-b border-border bg-muted/40 px-2">
                    {[
                      { id: "overview", label: "Overview" },
                      { id: "analytics", label: "Analytics" },
                      { id: "trades", label: "Trades" },
                      { id: "grid", label: "Trade equity curve" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={cn(
                          "relative px-3 py-2 text-[11px] font-medium tracking-wide transition-colors",
                          activeTab === tab.id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tab.label}
                        {activeTab === tab.id ? (
                          <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t bg-rose-500" />
                        ) : null}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {activeTab === "overview" ? (
                      <SimOverviewPanel
                        summary={summary}
                        equity={chartEquity}
                        trades={simQ.data.trades}
                        timeZone={timeZone}
                      />
                    ) : activeTab === "analytics" ? (
                      <SimAnalyticsPanel summary={summary} />
                    ) : activeTab === "trades" ? (
                      <div className="flex min-h-[24rem] flex-1 flex-col pb-10">
                        <div className="sticky top-0 z-10 flex shrink-0 items-end justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
                          <div>
                            <p className="text-sm font-medium tracking-tight">
                              Simulated trades
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                              {summary.filled} filled · {summary.skipped}{" "}
                              skipped
                            </p>
                          </div>
                        </div>
                        <div className="min-h-0 flex-1">
                          <SimTradesTable
                            rows={simQ.data.trades}
                            tradeEquity={simQ.data.trade_equity ?? {}}
                            timeZone={timeZone}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col">
                        <SessionLegend timeZone={timeZone} />
                        <div className="min-h-0 flex-1">
                          <TradeWiseGrid
                            tradeEquity={simQ.data.trade_equity ?? {}}
                            trades={simQ.data.trades}
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
function getDayDomain(
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
function buildSessionBands(
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

function StatTile({
  label,
  value,
  sub,
  positive,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean | null
}) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-sm font-semibold tabular-nums",
          positive === true
            ? "text-emerald-600 dark:text-emerald-400"
            : positive === false
              ? "text-rose-600 dark:text-rose-400"
              : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </div>
  )
}

function SimAnalyticsPanel({
  summary,
}: {
  summary: NonNullable<Awaited<ReturnType<typeof api.simulate>>["summary"]>
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

  const long = a.by_side.long
  const short = a.by_side.short

  return (
    <div className="space-y-4 p-3">
      {/* Executive strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <StatTile
          label="Avg PnL / trade"
          value={`$${formatUsd(a.avg_pnl_usd)}`}
          positive={a.avg_pnl_usd > 0}
        />
        <StatTile
          label="Avg win"
          value={`$${formatUsd(a.avg_win_usd)}`}
          positive
          sub={`${summary.wins} wins`}
        />
        <StatTile
          label="Avg loss"
          value={`$${formatUsd(a.avg_loss_usd)}`}
          positive={false}
          sub={`${summary.losses} losses`}
        />
        <StatTile
          label="Best trade"
          value={`$${formatUsd(a.best_trade?.pnl_usd)}`}
          positive={a.best_trade ? a.best_trade.pnl_usd > 0 : null}
          sub={`#${a.best_trade?.trade_id ?? "—"}`}
        />
        <StatTile
          label="Worst trade"
          value={`$${formatUsd(a.worst_trade?.pnl_usd)}`}
          positive={a.worst_trade ? a.worst_trade.pnl_usd > 0 : null}
          sub={`#${a.worst_trade?.trade_id ?? "—"}`}
        />
        <StatTile
          label="Max streak"
          value={`${a.max_consecutive_wins}W / ${a.max_consecutive_losses}L`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Duration */}
        <div className="rounded-md border bg-card p-3">
          <p className="mb-2.5 text-xs font-semibold tracking-tight">
            Duration analysis
          </p>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Shortest win"
              value={formatDuration(a.shortest_win_ms)}
              positive
            />
            <StatTile
              label="Shortest loss"
              value={formatDuration(a.shortest_loss_ms)}
              positive={false}
            />
            <StatTile
              label="Avg win duration"
              value={formatDuration(a.avg_win_duration_ms)}
              positive
            />
            <StatTile
              label="Avg loss duration"
              value={formatDuration(a.avg_loss_duration_ms)}
              positive={false}
            />
          </div>
        </div>

        {/* Long vs Short deep dive */}
        <div className="rounded-md border bg-card p-3">
          <p className="mb-2.5 text-xs font-semibold tracking-tight">
            Long vs Short analytics
          </p>
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 rounded-md bg-emerald-500/[0.06] px-2 py-1.5 text-[11px]">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                LONG
              </span>
              <span className="text-right font-mono tabular-nums">
                avg ${formatUsd(long?.avg_pnl_usd)}
              </span>
              <span className="text-right font-mono tabular-nums text-emerald-600">
                +${formatUsd(long?.biggest_win_usd)}
              </span>
              <span className="text-right font-mono tabular-nums text-rose-600">
                ${formatUsd(long?.biggest_loss_usd)}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 rounded-md bg-rose-500/[0.06] px-2 py-1.5 text-[11px]">
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                SHORT
              </span>
              <span className="text-right font-mono tabular-nums">
                avg ${formatUsd(short?.avg_pnl_usd)}
              </span>
              <span className="text-right font-mono tabular-nums text-emerald-600">
                +${formatUsd(short?.biggest_win_usd)}
              </span>
              <span className="text-right font-mono tabular-nums text-rose-600">
                ${formatUsd(short?.biggest_loss_usd)}
              </span>
            </div>
          </div>
        </div>

        {/* Session PnL */}
        <div className="rounded-md border bg-card p-3">
          <p className="mb-2.5 text-xs font-semibold tracking-tight">
            PnL by session
          </p>
          <div className="space-y-2">
            {Object.entries(a.session_pnls).map(([session, pnl]) => {
              const label =
                session === "sydney_tokyo" ? "Sydney / Tokyo" : "London / NY"
              return (
                <div
                  key={session}
                  className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                >
                  <span className="text-[11px] font-medium">{label}</span>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      pnlClass(pnl),
                    )}
                  >
                    {formatPnl(pnl)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Monthly PnL */}
        <div className="rounded-md border bg-card p-3">
          <p className="mb-2.5 text-xs font-semibold tracking-tight">
            Monthly PnL
          </p>
          <div className="max-h-48 overflow-auto">
            <div className="grid grid-cols-[1fr_4rem_3rem_3rem] gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Month</span>
              <span className="text-right">PnL</span>
              <span className="text-right">W</span>
              <span className="text-right">L</span>
            </div>
            {a.monthly_pnls.map((m) => (
              <div
                key={m.period}
                className="grid grid-cols-[1fr_4rem_3rem_3rem] gap-1 border-b border-border/40 py-1.5 text-[11px]"
              >
                <span className="font-mono">{m.period}</span>
                <span
                  className={cn(
                    "text-right font-mono font-semibold tabular-nums",
                    pnlClass(m.pnl_usd),
                  )}
                >
                  {formatPnl(m.pnl_usd)}
                </span>
                <span className="text-right font-mono text-emerald-600">
                  {m.wins}
                </span>
                <span className="text-right font-mono text-rose-600">
                  {m.losses}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Keep a top-layer spinner until Recharts has a real SVG size (was painting blank). */
function DeferredTradeEquityChart({
  equity,
  sessionBands,
  timeZone,
  domain,
}: {
  equity: EquityPoint[]
  sessionBands: import("@/components/charts/signed-area-curve-chart").SessionBand[]
  timeZone: string
  domain: [number, number] | undefined
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
      className="relative h-28 w-full min-h-[7rem] overflow-hidden rounded-md bg-muted/15"
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

function SimTradesTable({
  rows,
  tradeEquity,
  timeZone,
}: {
  rows: NonNullable<
    Awaited<ReturnType<typeof api.simulate>>
  >["trades"]
  tradeEquity: Record<string, EquityPoint[]>
  timeZone: string
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
  const rowGrid =
    "grid grid-cols-[2.5rem_3.5rem_minmax(11rem,1.15fr)_4rem_4rem_3.25rem_3.25rem_4rem_4rem_minmax(13rem,0.95fr)_2rem] items-center gap-x-3 px-3"

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
        extremum={
          zoomedRow
            ? {
                maxRunup: zoomedRow.max_runup_usd,
                maxDrawdown: zoomedRow.max_drawdown_usd,
              }
            : undefined
        }
      />
    </>
  )
}
