import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react"

import { api, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/trades")({
  component: TradesPage,
})

const PAGE_SIZE = 50

function formatCompact(n: number): string {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

function formatPnl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(2)}`
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  return String(n)
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function strategyKey(s: Pick<StrategyInfo, "symbol" | "strategy_id">): string {
  return `${s.symbol}::${s.strategy_id}`
}

type SymbolGroup = {
  symbol: string
  strategies: StrategyInfo[]
}

function TradesPage() {
  const { applied, selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
      out.push({
        symbol,
        strategies: list,
      })
    }
    out.sort((a, b) => a.symbol.localeCompare(b.symbol))
    return out
  }, [filtered])

  const selected = useMemo(() => {
    if (!applied.symbol || !applied.strategyId) return null
    return (
      strategies.find(
        (s) =>
          s.symbol === applied.symbol && s.strategy_id === applied.strategyId,
      ) ?? null
    )
  }, [strategies, applied.symbol, applied.strategyId])

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

  const tradesQ = useQuery({
    queryKey: ["trades", applied.symbol, applied.strategyId, page],
    queryFn: () =>
      api.trades({
        symbol: applied.symbol,
        strategy_id: applied.strategyId,
        page,
        page_size: PAGE_SIZE,
        sort: "trade_id",
        order: "desc",
      }),
    enabled: Boolean(applied.symbol && applied.strategyId),
  })

  useEffect(() => {
    setPage(1)
  }, [applied.symbol, applied.strategyId])

  const totalTrades = useMemo(
    () => strategies.reduce((n, s) => n + s.trade_count, 0),
    [strategies],
  )
  const symbolCount = useMemo(
    () => new Set(strategies.map((s) => s.symbol)).size,
    [strategies],
  )

  const pageStats = useMemo(() => {
    const rows = tradesQ.data?.rows ?? []
    let closed = 0
    let net = 0
    let wins = 0
    for (const row of rows) {
      if (row.is_open) continue
      closed += 1
      if (row.tv_net_pnl != null) {
        net += row.tv_net_pnl
        if (row.tv_net_pnl >= 0) wins += 1
      }
    }
    return { closed, net, wins }
  }, [tradesQ.data?.rows])

  const totalPages = tradesQ.data
    ? Math.max(1, Math.ceil(tradesQ.data.total / PAGE_SIZE))
    : 1

  const loading = strategiesQ.isLoading
  const refreshing = strategiesQ.isFetching || tradesQ.isFetching

  function selectStrategy(s: StrategyInfo) {
    selectAndApply({ symbol: s.symbol, strategyId: s.strategy_id })
  }

  function toggleSymbol(symbol: string) {
    setExpanded((prev) => ({ ...prev, [symbol]: !prev[symbol] }))
  }

  function refreshAll() {
    void strategiesQ.refetch()
    if (applied.symbol && applied.strategyId) void tradesQ.refetch()
  }

  function isExpanded(symbol: string): boolean {
    if (query.trim()) return true
    if (expanded[symbol] != null) return expanded[symbol]
    return symbol === applied.symbol
  }

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <div className="inline-flex items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-muted/30">
          <KpiStat
            label="Strategies"
            value={loading ? "…" : String(strategies.length)}
            valueClass="text-violet-600 dark:text-violet-400"
          />
          <KpiStat
            label="Trades"
            value={loading ? "…" : formatCompact(totalTrades)}
            valueClass="text-sky-600 dark:text-sky-400"
          />
          <KpiStat
            label="Symbols"
            value={loading ? "…" : String(symbolCount)}
            valueClass="text-emerald-600 dark:text-emerald-400"
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0"
            onClick={refreshAll}
            disabled={refreshing}
            title="Reload strategies and trades"
          >
            <RefreshCw
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </div>

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
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No matches.</p>
            ) : (
              <ul className="space-y-0.5 p-1">
                {groups.map((group) => {
                  const open = isExpanded(group.symbol)
                  const symbolActive = group.symbol === applied.symbol
                  return (
                    <li key={group.symbol}>
                      <button
                        type="button"
                        onClick={() => toggleSymbol(group.symbol)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
                          symbolActive && "bg-muted/30",
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
                                      ? "bg-violet-500/10 text-foreground ring-1 ring-violet-500/25"
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
                                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight">
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
          {!applied.symbol || !applied.strategyId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <BarChart3 className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select a strategy to view trades
              </p>
            </div>
          ) : (
            <>
              <div className="relative flex h-12 shrink-0 items-center border-b border-border px-3">
                <div className="relative z-10 inline-flex h-9 max-w-[min(100%,22rem)] items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-muted/30 text-[11px]">
                  <MetaStat
                    label="Trades"
                    value={
                      tradesQ.isLoading
                        ? "…"
                        : formatCompact(tradesQ.data?.total ?? selected?.trade_count ?? 0)
                    }
                    valueClass="text-sky-600 dark:text-sky-400"
                  />
                  <MetaStat
                    label="Wins"
                    value={
                      tradesQ.isLoading
                        ? "…"
                        : `${pageStats.wins}/${pageStats.closed || "—"}`
                    }
                    valueClass="text-emerald-600 dark:text-emerald-400"
                  />
                  <MetaStat
                    label="PnL"
                    value={
                      tradesQ.isLoading ? "…" : formatPnl(pageStats.net)
                    }
                    valueClass={
                      pageStats.net > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : pageStats.net < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : undefined
                    }
                  />
                </div>

                <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-3">
                  <div className="pointer-events-auto flex min-w-0 max-w-[min(100%,24rem)] flex-col items-center gap-0.5">
                    <div className="flex items-center gap-2">
                      <h2 className="font-mono text-base leading-none font-semibold tracking-tight">
                        {applied.symbol}
                      </h2>
                      <Badge
                        variant="secondary"
                        className="h-5 max-w-[12rem] truncate text-[10px] text-violet-700 dark:text-violet-300"
                      >
                        {applied.strategyId}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 px-2.5"
                    disabled={page <= 1 || tradesQ.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 px-2.5"
                    disabled={page >= totalPages || tradesQ.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>

              <TradesTable
                loading={tradesQ.isLoading}
                error={tradesQ.isError ? String(tradesQ.error) : null}
                rows={tradesQ.data?.rows ?? []}
                total={tradesQ.data?.total ?? 0}
                page={page}
                pageSize={PAGE_SIZE}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function KpiStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 py-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums text-foreground",
          valueClass,
        )}
      >
        {value}
      </span>
    </div>
  )
}

function MetaStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex h-full min-w-0 items-center gap-1.5 px-3">
      <span className="shrink-0 text-[10px] leading-none font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "truncate text-[12px] leading-none font-semibold tabular-nums",
          valueClass ?? "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function TradesTable({
  loading,
  error,
  rows,
  total,
  page,
  pageSize,
}: {
  loading: boolean
  error: string | null
  rows: {
    trade_id: number
    side: string
    open_time: string | null
    open_price: number | null
    close_time: string | null
    close_price: number | null
    size: number
    tv_net_pnl: number | null
    is_open: boolean
  }[]
  total: number
  page: number
  pageSize: number
}) {
  const rowGrid =
    "grid grid-cols-[3.5rem_4.5rem_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_4.5rem_5.5rem_4.5rem] items-center gap-x-3 px-4"

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-2.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1.5 h-3 w-40" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                rowGrid,
                "h-9 border-b border-border/40",
                i % 2 === 1 && "bg-muted/15",
              )}
            >
              {Array.from({ length: 9 }).map((_, j) => (
                <Skeleton key={j} className="h-3 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const showingTo = Math.min(page * pageSize, total)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-medium tracking-tight">Trade list</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {total === 0
              ? "No trades"
              : `${showingFrom}–${showingTo} of ${total.toLocaleString()}`}
          </p>
        </div>
        <span className="pb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
          Newest first
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className={cn(
            rowGrid,
            "sticky top-0 z-10 h-10 border-b border-border bg-muted/70 text-[10px] font-medium tracking-wider text-muted-foreground uppercase backdrop-blur-sm",
          )}
        >
          <span>#</span>
          <span>Side</span>
          <span>Open</span>
          <span className="text-right">Open px</span>
          <span>Close</span>
          <span className="text-right">Close px</span>
          <span className="text-right">Size</span>
          <span className="text-right">TV PnL</span>
          <span className="text-right">Status</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
            No trades found.
          </div>
        ) : (
          rows.map((row, i) => {
            const isLong =
              row.side.toLowerCase() === "long" ||
              row.side.toLowerCase() === "buy"
            const pnl = row.tv_net_pnl
            return (
              <div
                key={row.trade_id}
                className={cn(
                  rowGrid,
                  "border-b border-border/50 py-2.5 transition-colors hover:bg-violet-500/[0.06]",
                  i % 2 === 1 && "bg-muted/20",
                )}
              >
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {row.trade_id}
                </span>
                <div>
                  <span
                    className={cn(
                      "inline-flex min-w-[2.75rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                      isLong
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {row.side}
                  </span>
                </div>
                <span className="truncate font-mono text-[11px] tabular-nums">
                  {formatTime(row.open_time)}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {formatPrice(row.open_price)}
                </span>
                <span className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatTime(row.close_time)}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatPrice(row.close_price)}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {row.size}
                </span>
                <span
                  className={cn(
                    "text-right font-mono text-[12px] font-semibold tabular-nums",
                    pnl == null
                      ? "text-muted-foreground"
                      : pnl > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : pnl < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-foreground",
                  )}
                >
                  {formatPnl(pnl)}
                </span>
                <div className="flex justify-end">
                  {row.is_open ? (
                    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      Open
                    </span>
                  ) : (
                    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-muted text-muted-foreground">
                      Closed
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
