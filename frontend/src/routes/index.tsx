import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Activity, BarChart3, LineChart, Search, Table2 } from "lucide-react"

import { api, type Dataset, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { TradingSessions } from "@/components/trading-sessions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/")({
  component: HomePage,
})

type SymbolRow = {
  symbol: string
  dataset?: Dataset
  strategies: StrategyInfo[]
}

function formatCompact(n: number): string {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

function formatLastTick(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function HomePage() {
  const navigate = useNavigate()
  const { selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [withTradesOnly, setWithTradesOnly] = useState(false)

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets })
  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: api.strategies,
  })
  const health = useQuery({ queryKey: ["health"], queryFn: api.health })

  const rows = useMemo(() => {
    const bySymbol = new Map<string, SymbolRow>()
    for (const d of datasets.data ?? []) {
      bySymbol.set(d.symbol, { symbol: d.symbol, dataset: d, strategies: [] })
    }
    for (const s of strategies.data ?? []) {
      const existing = bySymbol.get(s.symbol)
      if (existing) existing.strategies.push(s)
      else bySymbol.set(s.symbol, { symbol: s.symbol, strategies: [s] })
    }
    return [...bySymbol.values()].sort((a, b) =>
      a.symbol.localeCompare(b.symbol),
    )
  }, [datasets.data, strategies.data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (withTradesOnly && r.strategies.length === 0) return false
      if (!q) return true
      return (
        r.symbol.toLowerCase().includes(q) ||
        r.strategies.some((s) => s.strategy_id.toLowerCase().includes(q))
      )
    })
  }, [rows, query, withTradesOnly])

  function go(
    path: "/overview" | "/ticks" | "/trades" | "/simulate",
    symbol: string,
    strategyId?: string,
  ) {
    selectAndApply({ symbol, strategyId: strategyId ?? "" })
    void navigate({ to: path })
  }

  const loading = datasets.isLoading || strategies.isLoading
  const strategyTotal = strategies.data?.length ?? 0

  return (
    <div className="space-y-6">
      <TradingSessions />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Symbols</h1>
          {health.isError ? (
            <Badge variant="destructive">API offline</Badge>
          ) : (
            <Badge variant="secondary">
              {filtered.length}
              {filtered.length !== rows.length ? ` / ${rows.length}` : ""}{" "}
              symbols · {strategyTotal} strat
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={withTradesOnly ? "default" : "outline"}
            onClick={() => setWithTradesOnly((v) => !v)}
          >
            With trades
          </Button>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-8 pl-8"
            />
          </div>
        </div>
      </div>

      {health.isError && (
        <p className="text-sm text-destructive">
          Start backend on :8000 — {String(health.error)}
        </p>
      )}
      {(datasets.isError || strategies.isError) && (
        <p className="text-sm text-destructive">
          {datasets.isError && String(datasets.error)}
          {strategies.isError && String(strategies.error)}
        </p>
      )}

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No symbols match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[7rem]">Symbol</TableHead>
                  <TableHead>Last tick</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Ticks</TableHead>
                  <TableHead>Strategies</TableHead>
                  <TableHead className="w-[9rem] text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const d = row.dataset
                  const defaultStrategy = row.strategies[0]?.strategy_id
                  const chips = row.strategies.slice(0, 4)
                  const extra = row.strategies.length - chips.length

                  return (
                    <TableRow
                      key={row.symbol}
                      className="cursor-pointer"
                      onClick={() => {
                        if (d) go("/overview", row.symbol, defaultStrategy)
                        else if (defaultStrategy)
                          go("/trades", row.symbol, defaultStrategy)
                      }}
                    >
                      <TableCell className="font-medium">{row.symbol}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatLastTick(d?.max_time_utc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {d ? d.file_count : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {d ? formatCompact(d.row_count) : "—"}
                      </TableCell>
                      <TableCell>
                        {row.strategies.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {chips.map((s) => (
                              <button
                                key={s.strategy_id}
                                type="button"
                                title={`${s.trade_count} trades`}
                                className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium hover:bg-muted/80"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  go("/simulate", row.symbol, s.strategy_id)
                                }}
                              >
                                {s.strategy_id}
                                <span className="ml-1 text-muted-foreground">
                                  {s.trade_count}
                                </span>
                              </button>
                            ))}
                            {extra > 0 && (
                              <span className="text-xs text-muted-foreground">
                                +{extra}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className="inline-flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconAction
                            label="Overview"
                            disabled={!d}
                            onClick={() =>
                              go("/overview", row.symbol, defaultStrategy)
                            }
                          >
                            <LineChart className="size-3.5 text-emerald-400" />
                          </IconAction>
                          <IconAction
                            label="Ticks"
                            disabled={!d}
                            onClick={() =>
                              go("/ticks", row.symbol, defaultStrategy)
                            }
                          >
                            <Table2 className="size-3.5 text-amber-400" />
                          </IconAction>
                          <IconAction
                            label="Trades"
                            disabled={!defaultStrategy}
                            onClick={() =>
                              go("/trades", row.symbol, defaultStrategy)
                            }
                          >
                            <BarChart3 className="size-3.5 text-violet-400" />
                          </IconAction>
                          <IconAction
                            label="Simulate"
                            disabled={!defaultStrategy}
                            onClick={() =>
                              go("/simulate", row.symbol, defaultStrategy)
                            }
                          >
                            <Activity className="size-3.5 text-rose-400" />
                          </IconAction>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
