import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { api } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { localInputToApi } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/ticks")({
  component: TicksPage,
})

function TicksPage() {
  const { applied } = useFilters()
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState("timestamp_ms")
  const [order, setOrder] = useState<"asc" | "desc">("asc")
  const pageSize = 100

  const q = useQuery({
    queryKey: ["ticks", applied, page, sort, order],
    queryFn: () =>
      api.ticks({
        symbol: applied.symbol,
        from: localInputToApi(applied.from),
        to: localInputToApi(applied.to),
        page,
        page_size: pageSize,
        sort,
        order,
      }),
  })

  function toggle(col: string) {
    if (sort === col) setOrder((o) => (o === "asc" ? "desc" : "asc"))
    else {
      setSort(col)
      setOrder("asc")
    }
    setPage(1)
  }

  const mark = (col: string) =>
    sort === col ? (order === "asc" ? " ↑" : " ↓") : ""

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / pageSize)) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {q.data ? `${q.data.total.toLocaleString()} rows` : "Loading…"} —{" "}
            {applied.symbol}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                <TableHead>
                  <button type="button" onClick={() => toggle("timestamp_ms")}>
                    timestamp_ms{mark("timestamp_ms")}
                  </button>
                </TableHead>
                <TableHead>time_utc</TableHead>
                <TableHead>time_broker</TableHead>
                <TableHead>side</TableHead>
                <TableHead>
                  <button type="button" onClick={() => toggle("price")}>
                    price{mark("price")}
                  </button>
                </TableHead>
                <TableHead>symbol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No ticks for applied filters.
                  </TableCell>
                </TableRow>
              ) : (
                q.data.rows.map((row) => (
                  <TableRow key={`${row.timestamp_ms}-${row.side}-${row.price}`}>
                    <TableCell className="font-mono text-xs">
                      {row.timestamp_ms}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.time_utc}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.time_broker}
                    </TableCell>
                    <TableCell className="text-xs">{row.side}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.price}
                    </TableCell>
                    <TableCell className="text-xs">{row.symbol}</TableCell>
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
