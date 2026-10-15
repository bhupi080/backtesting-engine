import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { api } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/trades")({
  component: TradesPage,
})

function TradesPage() {
  const { applied } = useFilters()
  const [page, setPage] = useState(1)
  const pageSize = 50

  const q = useQuery({
    queryKey: ["trades", applied.symbol, applied.strategyId, page],
    queryFn: () =>
      api.trades({
        symbol: applied.symbol,
        strategy_id: applied.strategyId,
        page,
        page_size: pageSize,
      }),
  })

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / pageSize)) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <p className="text-sm text-muted-foreground">
          {applied.symbol} / {applied.strategyId} —{" "}
          {q.data ? `${q.data.total} trades` : "…"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </Button>
          <span className="text-sm self-center">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.isError && (
        <p className="text-sm text-destructive">{String(q.error)}</p>
      )}
      {q.data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>side</TableHead>
                <TableHead>open</TableHead>
                <TableHead>open px</TableHead>
                <TableHead>close</TableHead>
                <TableHead>close px</TableHead>
                <TableHead>size</TableHead>
                <TableHead>TV PnL</TableHead>
                <TableHead>status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    No trades found.
                  </TableCell>
                </TableRow>
              ) : (
                q.data.rows.map((row) => (
                  <TableRow key={row.trade_id}>
                    <TableCell className="text-xs">{row.trade_id}</TableCell>
                    <TableCell className="text-xs">{row.side}</TableCell>
                    <TableCell className="text-xs">{row.open_time ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.open_price ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.close_time ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.close_price ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.size}</TableCell>
                    <TableCell className="text-xs">
                      {row.tv_net_pnl == null ? "—" : row.tv_net_pnl.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {row.is_open ? (
                        <Badge>open</Badge>
                      ) : (
                        <Badge variant="secondary">closed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
