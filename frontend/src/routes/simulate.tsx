import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  ChevronDown,
  Play,
  RefreshCw,
  Search,
} from "lucide-react"

import { PreciseEquityCurveChart } from "@/components/charts"
import { api, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
  const [selectedTrade, setSelectedTrade] = useState<number | null>(null)

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

  const simQ = useQuery({
    queryKey: ["simulate", applied.symbol, applied.strategyId, runKey],
    queryFn: () =>
      api.simulate({
        symbol: applied.symbol,
        strategy_id: applied.strategyId,
        lots,
        commission_per_lot: commission,
        starting_balance: balance,
        chart_tf_minutes: chartTf,
      }),
    enabled: Boolean(applied.symbol && applied.strategyId),
  })

  useEffect(() => {
    setSelectedTrade(null)
  }, [applied.symbol, applied.strategyId])

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
    setRunKey((k) => k + 1)
  }

  const loading = strategiesQ.isLoading
  const hasSelection = Boolean(applied.symbol && applied.strategyId)

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background/60 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div className="flex h-12 shrink-0 items-center border-b border-border px-2.5">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 bg-muted/40 pl-7"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
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
        </aside>

        <section className="flex min-h-0 flex-col">
          {!hasSelection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Activity className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select a strategy to run a tick simulation
              </p>
            </div>
          ) : (
            <>
              <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
                <div className="relative flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
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
                      disabled={simQ.isFetching}
                      onClick={runSim}
                    >
                      {simQ.isFetching ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      Run
                    </Button>
                  </div>
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
                </div>
                {simQ.data?.meta?.rule ? (
                  <p className="text-[11px] text-muted-foreground">
                    {simQ.data.meta.rule}
                  </p>
                ) : null}
              </div>

              {simQ.isLoading ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-48 w-full" />
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : simQ.isError ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <p className="text-sm text-destructive">
                    {String(simQ.error)}
                  </p>
                </div>
              ) : simQ.data && summary ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4 lg:grid-cols-8">
                    <Stat
                      label="Sim PnL"
                      value={`$${formatUsd(summary.sim_pnl_usd)}`}
                      valueClass={pnlClass(summary.sim_pnl_usd)}
                    />
                    <Stat
                      label="TV PnL"
                      value={`$${formatUsd(summary.tv_pnl_usd)}`}
                      valueClass={pnlClass(summary.tv_pnl_usd)}
                    />
                    <Stat
                      label="Diff"
                      value={`$${formatUsd(summary.pnl_diff_usd)}`}
                      valueClass={pnlClass(summary.pnl_diff_usd)}
                    />
                    <Stat
                      label="Return"
                      value={`${formatUsd(summary.return_pct)}%`}
                      valueClass={pnlClass(summary.return_pct)}
                    />
                    <Stat
                      label="Win rate"
                      value={`${formatUsd(summary.win_rate * 100, 1)}%`}
                    />
                    <Stat
                      label="PF"
                      value={
                        summary.profit_factor == null
                          ? "∞"
                          : formatUsd(summary.profit_factor)
                      }
                    />
                    <Stat
                      label="Max DD"
                      value={`${formatUsd(summary.max_drawdown_pct)}%`}
                      valueClass="text-rose-600 dark:text-rose-400"
                    />
                    <Stat
                      label="Filled"
                      value={`${summary.filled} / ${summary.trades}`}
                    />
                  </div>

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
                      className="h-44 w-full aspect-auto"
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
                          className="h-40 w-full aspect-auto"
                          emptyMessage="No tick path for this trade"
                          showExtremumStats
                          extremum={tradeExtremum}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="flex min-h-[14rem] flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-end justify-between gap-3 border-b border-border px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium tracking-tight">
                          Simulated trades
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {summary.filled} filled · {summary.skipped} skipped
                        </p>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
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
            </>
          )}
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

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-sm font-semibold tabular-nums",
          valueClass,
        )}
      >
        {value}
      </div>
    </div>
  )
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
  const rowGrid =
    "grid grid-cols-[3rem_4rem_minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.65fr)_4rem_4rem_4.5rem_4.5rem_4.5rem_4.5rem_4.5rem] items-center gap-x-3 px-4"

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
          "sticky top-0 z-10 h-10 border-b border-border bg-muted/70 text-[10px] font-medium tracking-wider text-muted-foreground uppercase backdrop-blur-sm",
        )}
      >
        <span>#</span>
        <span>Dir</span>
        <span>TV open → close</span>
        <span className="text-right">Fill in</span>
        <span className="text-right">Fill out</span>
        <span className="text-right">Slip in</span>
        <span className="text-right">Slip out</span>
        <span className="text-right">Run-up</span>
        <span className="text-right">Max DD</span>
        <span className="text-right">TV PnL</span>
        <span className="text-right">Sim PnL</span>
      </div>
      {rows.map((row, i) => {
        const disabled = row.status !== "ok" || row.net_pnl_usd == null
        const isLong = row.side.toLowerCase() === "long"
        const selected = selectedId === row.trade_id
        return (
          <button
            key={row.trade_id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(row.trade_id)}
            className={cn(
              rowGrid,
              "w-full border-b border-border/50 py-2.5 text-left transition-colors",
              disabled
                ? "cursor-default opacity-50"
                : "cursor-pointer hover:bg-rose-500/[0.06]",
              selected && "bg-sky-500/10 ring-1 ring-inset ring-sky-500/30",
              i % 2 === 1 && !selected && "bg-muted/20",
            )}
          >
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.trade_id}
            </span>
            <span
              className={cn(
                "inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold",
                isLong
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              )}
            >
              {row.side}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {row.open_time?.slice(0, 16) ?? "—"} →{" "}
              {row.close_time?.slice(0, 16) ?? "—"}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums">
              {row.fill_entry_price ?? "—"}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums">
              {row.fill_exit_price ?? "—"}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.entry_slip_pips ?? "—"}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.exit_slip_pips ?? "—"}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] font-semibold tabular-nums",
                pnlClass(row.max_runup_usd),
              )}
            >
              {formatPnl(row.max_runup_usd)}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] font-semibold tabular-nums",
                pnlClass(row.max_drawdown_usd),
              )}
            >
              {formatPnl(row.max_drawdown_usd)}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] font-semibold tabular-nums",
                pnlClass(row.tv_pnl_usd),
              )}
            >
              {formatPnl(row.tv_pnl_usd)}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[11px] font-semibold tabular-nums",
                pnlClass(row.net_pnl_usd),
              )}
            >
              {formatPnl(row.net_pnl_usd)}
            </span>
          </button>
        )
      })}
    </>
  )
}
