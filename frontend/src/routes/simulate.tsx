import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { localInputToApi } from "@/lib/time"
import { PreciseEquityCurveChart } from "@/components/charts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/simulate")({
  component: SimulatePage,
})

function SimulatePage() {
  const { applied } = useFilters()
  const q = useQuery({
    queryKey: ["simulate", applied],
    queryFn: () =>
      api.simulate({
        symbol: applied.symbol,
        strategy_id: applied.strategyId,
        from: localInputToApi(applied.from),
        to: localInputToApi(applied.to),
      }),
    enabled: Boolean(applied.symbol && applied.strategyId),
  })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Simulate</h1>
      <p className="text-sm text-muted-foreground">
        PnL from trade open/close prices (backend).
      </p>
      {q.isLoading && <Skeleton className="h-24 w-full" />}
      {q.isError && (
        <p className="text-sm text-destructive">{String(q.error)}</p>
      )}
      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Trades" value={String(q.data.trade_count)} />
            <Stat title="Closed" value={String(q.data.closed_count)} />
            <Stat title="Total PnL" value={q.data.total_pnl.toFixed(2)} />
            <Stat title="Max DD" value={q.data.max_drawdown.toFixed(2)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity curve</CardTitle>
            </CardHeader>
            <CardContent>
              <PreciseEquityCurveChart equity={q.data.equity} />
            </CardContent>
          </Card>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>side</TableHead>
                  <TableHead>sim PnL</TableHead>
                  <TableHead>TV PnL</TableHead>
                  <TableHead>cum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.trades.map((t) => (
                  <TableRow key={t.trade_id}>
                    <TableCell>{t.trade_id}</TableCell>
                    <TableCell>{t.side}</TableCell>
                    <TableCell>
                      {t.pnl == null ? "—" : t.pnl.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {t.tv_net_pnl == null ? "—" : t.tv_net_pnl.toFixed(2)}
                    </TableCell>
                    <TableCell>{t.cumulative_pnl.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold">{value}</CardContent>
    </Card>
  )
}
