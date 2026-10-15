import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { api } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { localInputToApi } from "@/lib/time"
import {
  SignedAreaCurveChart,
  priceSeriesToDeltaCurve,
} from "@/components/charts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
})

function OverviewPage() {
  const { applied } = useFilters()
  const q = useQuery({
    queryKey: ["overview", applied],
    queryFn: () =>
      api.overview({
        symbol: applied.symbol,
        from: localInputToApi(applied.from),
        to: localInputToApi(applied.to),
        side: applied.side || undefined,
      }),
    enabled: Boolean(applied.symbol),
  })

  const m = q.data?.metrics
  const deltaCurve = useMemo(
    () => priceSeriesToDeltaCurve(q.data?.series ?? []),
    [q.data?.series],
  )

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      {q.isLoading && <Skeleton className="h-24 w-full" />}
      {q.isError && (
        <p className="text-sm text-destructive">{String(q.error)}</p>
      )}
      {m && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric title="Ticks" value={m.tick_count.toLocaleString()} />
          <Metric title="BID" value={m.bid_count.toLocaleString()} />
          <Metric title="ASK" value={m.ask_count.toLocaleString()} />
          <Metric
            title="Last"
            value={m.last_price != null ? m.last_price.toFixed(5) : "—"}
          />
          <Metric
            title="Min"
            value={m.min_price != null ? m.min_price.toFixed(5) : "—"}
          />
          <Metric
            title="Max"
            value={m.max_price != null ? m.max_price.toFixed(5) : "—"}
          />
          <Metric
            title="Avg"
            value={m.avg_price != null ? m.avg_price.toFixed(5) : "—"}
          />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Price change from open (downsampled)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <SignedAreaCurveChart
              data={deltaCurve}
              valueLabel="Δ price"
              emptyMessage="No price series"
              showLevelGuides={false}
              formatValue={(n) => n.toFixed(5)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold">{value}</CardContent>
    </Card>
  )
}
