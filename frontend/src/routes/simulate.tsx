import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Activity,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Search,
} from "lucide-react"

import { PreciseEquityCurveChart } from "@/components/charts"
import { LoadingState } from "@/components/loading-state"
import { api, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/simulate")({
  component: SimulatePage,
})

type SymbolGroup = {
  symbol: string
  strategies: StrategyInfo[]
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
  const [selectedTrade, setSelectedTrade] = useState<number | null>(null)
  const [strategySidebarOpen, setStrategySidebarOpen] = useState(true)

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
    setSelectedTrade(null)
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

  const tradeWiseEquity = useMemo(() => {
    if (selectedTrade == null) return []
    return simQ.data?.trade_equity?.[String(selectedTrade)] ?? []
  }, [selectedTrade, simQ.data?.trade_equity])

  const selectedRow = useMemo(() => {
    if (selectedTrade == null) return null
    return simQ.data?.trades.find((t) => t.trade_id === selectedTrade) ?? null
  }, [selectedTrade, simQ.data?.trades])

  const tradeExtremum = useMemo(() => {
    if (!selectedRow) return undefined
    let maxRunupTime: string | null = null
    let maxDrawdownTime: string | null = null
    for (const p of tradeWiseEquity) {
      if (
        selectedRow.max_runup_usd != null &&
        maxRunupTime == null &&
        Math.abs(p.equity - selectedRow.max_runup_usd) < 0.005
      ) {
        maxRunupTime = p.t
      }
      if (
        selectedRow.max_drawdown_usd != null &&
        maxDrawdownTime == null &&
        Math.abs(p.equity - selectedRow.max_drawdown_usd) < 0.005
      ) {
        maxDrawdownTime = p.t
      }
    }
    return {
      maxRunup: selectedRow.max_runup_usd,
      maxDrawdown: selectedRow.max_drawdown_usd,
      maxRunupTime,
      maxDrawdownTime,
    }
  }, [selectedRow, tradeWiseEquity])

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
    setSelectedTrade(null)
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
      <div
        className={cn(
          "grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background/60",
          strategySidebarOpen
            ? "lg:grid-cols-[15rem_minmax(0,1fr)]"
            : "lg:grid-cols-[2.5rem_minmax(0,1fr)]",
        )}
      >
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          {strategySidebarOpen ? (
            <>
              <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="h-8 bg-muted/40 pl-7"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground"
                  title="Hide strategies"
                  onClick={() => setStrategySidebarOpen(false)}
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <LoadingState
                    className="py-10"
                    size="sm"
                    message="Loading strategies…"
                  />
                ) : groups.length === 0 ? (
                  <p className="p-4 text-xs text-muted-foreground">No matches.</p>
                ) : (
                  <ul className="space-y-0.5 p-1">
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
                                      onClick={() => selectStrategy(s)}
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
            </>
          ) : (
            <div className="flex h-12 shrink-0 items-center justify-center border-b border-border">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                title="Show strategies"
                onClick={() => setStrategySidebarOpen(true)}
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            </div>
          )}
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
            <div className="relative flex flex-wrap items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                {!strategySidebarOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    title="Show strategies"
                    onClick={() => setStrategySidebarOpen(true)}
                  >
                    <PanelLeftOpen className="size-3.5" />
                    Strategies
                  </Button>
                ) : null}
                <Field
                  label="Lots"
                  value={lots}
                  onChange={setLots}
                  step={0.01}
                  min={0.01}
                />
                <Field
                  label="Commission / lot"
                  value={commission}
                  onChange={setCommission}
                  step={0.1}
                  min={0}
                />
                <Field
                  label="Balance"
                  value={balance}
                  onChange={setBalance}
                  step={100}
                  min={100}
                />
                <Field
                  label="Chart TF (min)"
                  value={chartTf}
                  onChange={setChartTf}
                  step={1}
                  min={0}
                />
                <Button
                  size="sm"
                  className="h-9 gap-1.5 bg-rose-600 px-4 text-white hover:bg-rose-600/90"
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
              </div>
              {hasSelection ? (
                <div className="pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex">
                  <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-background/80 px-2 py-1 backdrop-blur-sm">
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
                </div>
              ) : null}
            </div>
            {hasRun && simQ.data?.meta?.rule ? (
              <p className="text-[11px] text-muted-foreground">
                {simQ.data.meta.rule}
                {settingsDirty ? (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    · settings changed — click Run to re-simulate
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {hasSelection
                  ? `Ready · ${applied.symbol} / ${applied.strategyId} · click Run to simulate`
                  : "Pick a symbol and strategy in the list, then click Run"}
              </p>
            )}
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
              message={`Replaying ${applied.symbol} / ${applied.strategyId} on tick fills…`}
            />
          ) : simQ.isError ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <p className="text-sm text-destructive">
                    {String(simQ.error)}
                  </p>
                </div>
              ) : simQ.data && summary ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  <SimKpiPanel summary={summary} />

                  <div className="shrink-0 border-b border-border px-3 py-2.5">
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      Account equity · ending $
                      {formatUsd(summary.ending_equity)}
                      {!selectedRow ? (
                        <span className="text-muted-foreground/80">
                          {" "}
                          · click a row below for trade-wise PnL
                        </span>
                      ) : null}
                    </p>
                    <PreciseEquityCurveChart
                      equity={chartEquity}
                      emptyMessage="No equity points (no tick fills)"
                      showExtremumStats
                    />
                    {selectedRow ? (
                      <div className="mt-2.5 border-t border-border pt-2.5">
                        <p className="mb-1.5 text-[12px] text-muted-foreground">
                          Trade-wise ·{" "}
                          <span className="font-semibold text-foreground">
                            #{selectedRow.trade_id}
                          </span>{" "}
                          {selectedRow.side}
                          {" · "}
                          sim{" "}
                          <span className={pnlClass(selectedRow.net_pnl_usd)}>
                            ${formatUsd(selectedRow.net_pnl_usd)}
                          </span>
                          <button
                            type="button"
                            className="ml-2 text-sky-500 underline-offset-2 hover:underline"
                            onClick={() => setSelectedTrade(null)}
                          >
                            Clear
                          </button>
                        </p>
                        <PreciseEquityCurveChart
                          equity={tradeWiseEquity}
                          emptyMessage="No tick path for this trade"
                          showExtremumStats
                          extremum={tradeExtremum}
                        />
                      </div>
                    ) : null}
                  </div>

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
                        rows={simQ.data.trades}
                        selectedId={selectedTrade}
                        onSelect={(id) =>
                          setSelectedTrade((cur) => (cur === id ? null : id))
                        }
                      />
                    </div>
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
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
  min: number
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
        className="h-9 w-[6.5rem] font-mono text-[12px]"
      />
    </label>
  )
}

type SimSummary = NonNullable<
  Awaited<ReturnType<typeof api.simulate>>["summary"]
>

function SimKpiPanel({ summary }: { summary: SimSummary }) {
  const long = summary.by_side?.long
  const short = summary.by_side?.short
  const ddUsd = summary.max_drawdown_usd ?? 0
  const closed = summary.wins + summary.losses
  const pfLabel =
    summary.profit_factor == null
      ? "∞"
      : summary.profit_factor.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 3,
        })

  return (
    <div className="shrink-0 border-b border-border">
      {/* Primary strip — TradingView-style: label + primary + secondary */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <KpiCell
          label="Total PnL"
          primary={
            <span className={pnlClass(summary.sim_pnl_usd)}>
              {formatPnl(summary.sim_pnl_usd)} USD
            </span>
          }
          secondary={
            <span className={pnlClass(summary.return_pct)}>
              {formatPnl(summary.return_pct)}%
            </span>
          }
        />
        <KpiCell
          label="Max drawdown"
          primary={
            <span className="text-rose-600 dark:text-rose-400">
              {formatUsd(ddUsd)} USD
            </span>
          }
          secondary={
            <span className="text-muted-foreground">
              {formatUsd(summary.max_drawdown_pct)}%
            </span>
          }
        />
        <KpiCell
          label="Profitable trades"
          primary={
            <span>
              {formatUsd(summary.win_rate * 100, 2)}%
            </span>
          }
          secondary={
            <span className="text-muted-foreground">
              {summary.wins} / {closed || summary.filled}
            </span>
          }
        />
        <KpiCell
          label="Profit factor"
          primary={<span>{pfLabel}</span>}
          secondary={
            <span className="text-muted-foreground">
              TV {formatPnl(summary.tv_pnl_usd)} · Δ{" "}
              <span className={pnlClass(summary.pnl_diff_usd)}>
                {formatPnl(summary.pnl_diff_usd)}
              </span>
            </span>
          }
        />
      </div>

      {/* Long vs Short comparison */}
      <div className="grid gap-px bg-border sm:grid-cols-2">
        <SideCompareCard
          side="long"
          filled={long?.filled ?? 0}
          totalFilled={summary.filled}
          sharePct={long?.share_pct ?? 0}
          pnl={long?.pnl_usd ?? 0}
          pnlSharePct={long?.pnl_share_pct ?? 0}
          winRate={long?.win_rate ?? 0}
          wins={long?.wins ?? 0}
          losses={long?.losses ?? 0}
          profitFactor={long?.profit_factor ?? null}
        />
        <SideCompareCard
          side="short"
          filled={short?.filled ?? 0}
          totalFilled={summary.filled}
          sharePct={short?.share_pct ?? 0}
          pnl={short?.pnl_usd ?? 0}
          pnlSharePct={short?.pnl_share_pct ?? 0}
          winRate={short?.win_rate ?? 0}
          wins={short?.wins ?? 0}
          losses={short?.losses ?? 0}
          profitFactor={short?.profit_factor ?? null}
        />
      </div>
    </div>
  )
}

function KpiCell({
  label,
  primary,
  secondary,
}: {
  label: string
  primary: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[15px] font-semibold tracking-tight tabular-nums">
          {primary}
        </span>
        {secondary ? (
          <span className="font-mono text-[12px] tabular-nums">{secondary}</span>
        ) : null}
      </div>
    </div>
  )
}

function SideCompareCard({
  side,
  filled,
  totalFilled,
  sharePct,
  pnl,
  pnlSharePct,
  winRate,
  wins,
  losses,
  profitFactor,
}: {
  side: "long" | "short"
  filled: number
  totalFilled: number
  sharePct: number
  pnl: number
  pnlSharePct: number
  winRate: number
  wins: number
  losses: number
  profitFactor: number | null
}) {
  const isLong = side === "long"
  const pf =
    profitFactor == null
      ? "∞"
      : profitFactor.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 3,
        })
  const closed = wins + losses
  const barPct = Math.min(100, Math.max(0, sharePct))

  return (
    <div className="bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              isLong
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
            )}
          >
            {side}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {filled} / {totalFilled} signals · {formatUsd(sharePct, 1)}%
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            pnlClass(pnl),
          )}
        >
          {formatPnl(pnl)}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            isLong ? "bg-emerald-500" : "bg-rose-500",
          )}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Win rate</div>
          <div className="mt-0.5 font-mono font-medium tabular-nums">
            {formatUsd(winRate * 100, 1)}%
            <span className="ml-1 text-muted-foreground">
              {wins}/{closed || filled}
            </span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">PnL share</div>
          <div
            className={cn(
              "mt-0.5 font-mono font-medium tabular-nums",
              pnlClass(pnl),
            )}
          >
            {formatUsd(pnlSharePct, 1)}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">PF</div>
          <div className="mt-0.5 font-mono font-medium tabular-nums">{pf}</div>
        </div>
      </div>
    </div>
  )
}

function formatSimTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const cleaned = iso.replace("T", " ").replace("Z", "")
  const m = cleaned.match(/(\d{4}-)?(\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  if (!m) return cleaned.slice(0, 16)
  return `${m[2]} ${m[3]}`
}

function SimTradesTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: NonNullable<
    Awaited<ReturnType<typeof api.simulate>>
  >["trades"]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  /**
   * Compare-first column order:
   * identity → times (TV vs Sim stacked) → fills/slip/excursion → PnL trio (TV | Sim | Δ)
   */
  const rowGrid =
    "grid grid-cols-[2.5rem_3.5rem_minmax(11rem,1.15fr)_4rem_4rem_3.25rem_3.25rem_4rem_4rem_minmax(13rem,0.95fr)] items-center gap-x-3 px-3"

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
        <span className="py-2.5 text-right">Run-up</span>
        <span className="py-2.5 text-right">Max DD</span>
        <span className="py-2.5 text-right">PnL compare</span>
      </div>

      {rows.map((row, i) => {
        const disabled = row.status !== "ok" || row.net_pnl_usd == null
        const isLong = row.side.toLowerCase() === "long"
        const selected = selectedId === row.trade_id
        const diff =
          row.net_pnl_usd != null && row.tv_pnl_usd != null
            ? row.net_pnl_usd - row.tv_pnl_usd
            : null
        return (
          <button
            key={row.trade_id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(row.trade_id)}
            className={cn(
              rowGrid,
              "w-full border-b border-border/40 py-2 text-left transition-colors",
              disabled
                ? "cursor-default opacity-45"
                : "cursor-pointer hover:bg-muted/35",
              selected && "bg-sky-500/10 ring-1 ring-inset ring-sky-500/30",
              i % 2 === 1 && !selected && "bg-muted/10",
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
          </button>
        )
      })}
    </>
  )
}
