import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Database } from "lucide-react"

import { api } from "@/lib/api"
import { TradingSessions } from "@/components/trading-sessions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health })
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets })

  const symbolCount = datasets.data?.length ?? 0
  const tickTotal =
    datasets.data?.reduce((n, d) => n + d.row_count, 0) ?? 0

  return (
    <div className="space-y-6">
      <TradingSessions />

      <section className="flex flex-col gap-4 rounded-2xl p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              Tick datasets
            </h1>
            {health.isError ? (
              <Badge variant="destructive">API offline</Badge>
            ) : (
              <>
                <Badge variant="secondary" className="tabular-nums">
                  {symbolCount} symbols
                </Badge>
                {tickTotal > 0 && (
                  <Badge variant="outline" className="tabular-nums">
                    {Intl.NumberFormat(undefined, {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(tickTotal)}{" "}
                    ticks
                  </Badge>
                )}
              </>
            )}
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            Manage coverage, run updates, and bootstrap new symbols from
            cTrader.
          </p>
        </div>
        <Button render={<Link to="/datasets" />} className="shrink-0 gap-2">
          <Database className="size-4" />
          Open datasets
          <ArrowRight className="size-4 opacity-70" />
        </Button>
      </section>
    </div>
  )
}
