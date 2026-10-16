import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Download,
  Database,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal,
} from "lucide-react"

import { LoadingState } from "@/components/loading-state"
import { api, type Dataset, type TickJob } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/datasets")({
  component: DatasetsPage,
})

type ConfirmKind = "update" | "update-all" | null

const RECENT_TICKS = 50

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
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

/** Compact last-tick for the symbol list sidebar. */
function formatLastTickShort(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function statusTone(status: string): string {
  switch (status) {
    case "running":
    case "queued":
      return "text-sky-600 dark:text-sky-400"
    case "done":
      return "text-emerald-600 dark:text-emerald-400"
    case "failed":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

function DatasetsPage() {
  const queryClient = useQueryClient()
  const { applied, selectAndApply } = useFilters()
  const [query, setQuery] = useState("")
  const [symbol, setSymbol] = useState(applied.symbol || "")
  const [jobId, setJobId] = useState<string | null>(null)
  const [bootstrapOpen, setBootstrapOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [fromDate, setFromDate] = useState(() => isoDaysAgo(90))
  const [toDate, setToDate] = useState("")
  const [force, setForce] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const datasetsQ = useQuery({ queryKey: ["datasets"], queryFn: api.datasets })
  const hoursQ = useQuery({
    queryKey: ["market-hours-symbols"],
    queryFn: api.marketHoursSymbols,
  })

  useEffect(() => {
    if (applied.symbol) setSymbol(applied.symbol)
  }, [applied.symbol])

  const rows = useMemo(() => {
    const bySymbol = new Map<string, Dataset | undefined>()
    for (const s of hoursQ.data ?? []) bySymbol.set(s, undefined)
    for (const d of datasetsQ.data ?? []) bySymbol.set(d.symbol, d)

    const q = query.trim().toLowerCase()
    return [...bySymbol.entries()]
      .map(([sym, dataset]) => ({ symbol: sym, dataset }))
      .filter((r) => !q || r.symbol.toLowerCase().includes(q))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [datasetsQ.data, hoursQ.data, query])

  const withData = useMemo(
    () => rows.filter((r) => r.dataset).length,
    [rows],
  )

  const selected = useMemo(
    () => rows.find((r) => r.symbol === symbol),
    [rows, symbol],
  )

  const inMarketHours = useMemo(() => {
    if (!symbol) return false
    const upper = symbol.toUpperCase()
    return (hoursQ.data ?? []).some((s) => s.toUpperCase() === upper)
  }, [hoursQ.data, symbol])

  const ticksQ = useQuery({
    queryKey: ["ticks-recent", symbol],
    queryFn: () =>
      api.ticks({
        symbol,
        sort: "timestamp_ms",
        order: "desc",
        page: 1,
        page_size: RECENT_TICKS,
      }),
    enabled: Boolean(symbol && selected?.dataset),
  })

  const jobQ = useQuery({
    queryKey: ["tick-job", jobId],
    queryFn: () => api.getTickJob(jobId!, 400),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === "running" || s === "queued" ? 1500 : false
    },
  })

  useEffect(() => {
    if (jobQ.data?.status === "done") {
      void queryClient.invalidateQueries({ queryKey: ["datasets"] })
      void queryClient.invalidateQueries({ queryKey: ["ticks-recent", symbol] })
    }
  }, [jobQ.data?.status, queryClient, symbol])

  const createJob = useMutation({
    mutationFn: api.createTickJob,
    onSuccess: (job) => {
      setActionError(null)
      setJobId(job.id)
      setBootstrapOpen(false)
      setConfirm(null)
    },
    onError: (err) => setActionError(String(err)),
  })

  const cancelJob = useMutation({
    mutationFn: (id: string) => api.cancelTickJob(id),
    onSuccess: (job) => {
      void queryClient.setQueryData(["tick-job", job.id], job)
    },
    onError: (err) => setActionError(String(err)),
  })

  const jobBusy =
    createJob.isPending ||
    jobQ.data?.status === "running" ||
    jobQ.data?.status === "queued"

  function selectSymbol(next: string) {
    setSymbol(next)
    selectAndApply({ symbol: next })
    setActionError(null)
  }

  function confirmUpdate() {
    if (confirm === "update" && symbol) {
      createJob.mutate({ cmd: "update", symbol })
    } else if (confirm === "update-all") {
      createJob.mutate({ cmd: "update" })
    }
  }

  function runBootstrap() {
    if (!symbol || !fromDate) return
    createJob.mutate({
      cmd: "bootstrap",
      symbol,
      from_date: fromDate,
      to_date: toDate || undefined,
      force,
    })
  }

  const loading = datasetsQ.isLoading || hoursQ.isLoading
  const hasJob = Boolean(jobId && (jobQ.data || jobQ.isLoading))
  const refreshing =
    datasetsQ.isFetching || hoursQ.isFetching || ticksQ.isFetching

  const totalTicks = useMemo(
    () =>
      (datasetsQ.data ?? []).reduce((sum, d) => sum + (d.row_count || 0), 0),
    [datasetsQ.data],
  )

  function refreshAll() {
    void datasetsQ.refetch()
    void hoursQ.refetch()
    if (symbol && selected?.dataset) void ticksQ.refetch()
  }

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <div className="inline-flex items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-muted/30">
          <KpiStat
            label="On disk"
            value={`${withData}/${rows.length}`}
            valueClass="text-emerald-600 dark:text-emerald-400"
          />
          <KpiStat
            label="Ticks"
            value={loading ? "…" : formatCompact(totalTicks)}
            valueClass="text-sky-600 dark:text-sky-400"
          />
          <KpiStat
            label="Ready"
            value={String(withData)}
            valueClass="text-violet-600 dark:text-violet-400"
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0"
            onClick={refreshAll}
            disabled={refreshing}
            title="Reload coverage, symbol list, and recent ticks"
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
              <LoadingState
                className="py-10"
                size="sm"
                message="Loading symbols…"
              />
            ) : rows.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No matches.</p>
            ) : (
              <ul className="p-1">
                {rows.map((row) => {
                  const active = row.symbol === symbol
                  const hasData = Boolean(row.dataset)
                  const lastShort = hasData
                    ? formatLastTickShort(row.dataset!.max_time_utc)
                    : ""
                  return (
                    <li key={row.symbol}>
                      <button
                        type="button"
                        onClick={() => selectSymbol(row.symbol)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          active
                            ? "bg-sky-500/10 text-foreground ring-1 ring-sky-500/25"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            hasData
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/30",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] font-medium leading-tight">
                            {row.symbol}
                          </span>
                          {hasData ? (
                            <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground tabular-nums">
                              {lastShort || "—"}
                              {" · "}
                              {formatCompact(row.dataset!.row_count)}
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground/60">
                              No ticks
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {!symbol ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Database className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select a symbol to view recent ticks
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={jobBusy || withData === 0}
                onClick={() => setConfirm("update-all")}
              >
                <Layers className="size-3.5" />
                Update all
              </Button>
            </div>
          ) : (
            <>
              <div className="relative flex h-12 shrink-0 items-center border-b border-border px-3">
                <div className="relative z-10 inline-flex h-9 max-w-[min(100%,28rem)] items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-muted/30 text-[11px]">
                  <MetaStat
                    label="Last"
                    value={formatLastTick(selected?.dataset?.max_time_utc)}
                    valueClass="text-amber-600 dark:text-amber-400"
                  />
                  <MetaStat
                    label="Days"
                    value={
                      selected?.dataset
                        ? selected.dataset.file_count.toLocaleString()
                        : "—"
                    }
                    valueClass="text-violet-600 dark:text-violet-400"
                  />
                  <MetaStat
                    label="Ticks"
                    value={
                      selected?.dataset
                        ? formatCompact(selected.dataset.row_count)
                        : "—"
                    }
                    valueClass="text-sky-600 dark:text-sky-400"
                  />
                </div>

                <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-3">
                  <div className="pointer-events-auto flex items-center gap-2">
                    <h2 className="font-mono text-base leading-none font-semibold tracking-tight">
                      {symbol}
                    </h2>
                    {selected?.dataset ? (
                      <Badge
                        variant="secondary"
                        className="h-5 text-[10px] text-emerald-700 dark:text-emerald-300"
                      >
                        On disk
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        Empty
                      </Badge>
                    )}
                    {!inMarketHours && (
                      <Badge
                        variant="destructive"
                        className="h-5 text-[10px]"
                      >
                        Not in market_hours
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="relative z-10 ml-auto flex items-center gap-4">
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 bg-emerald-600 px-4 text-white hover:bg-emerald-600/90 dark:bg-emerald-500"
                    disabled={!inMarketHours || jobBusy}
                    onClick={() => setConfirm("update")}
                  >
                    <Download className="size-3.5" />
                    Update
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 bg-violet-600 px-4 text-white hover:bg-violet-600/90 dark:bg-violet-500"
                    disabled={jobBusy || withData === 0}
                    onClick={() => setConfirm("update-all")}
                  >
                    <Layers className="size-3.5" />
                    Update all
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 bg-blue-800 px-4 text-white hover:bg-blue-800/90 dark:bg-blue-700"
                    disabled={!inMarketHours || jobBusy}
                    onClick={() => {
                      setActionError(null)
                      setBootstrapOpen(true)
                    }}
                  >
                    <Plus className="size-3.5" />
                    New dataset
                  </Button>
                </div>
              </div>

              {(!inMarketHours ||
                (actionError && !bootstrapOpen && confirm === null)) && (
                <div className="shrink-0 space-y-1 border-b border-border px-3 py-2">
                  {!inMarketHours && (
                    <p className="text-xs text-destructive">
                      Add this symbol to market_hours.yml before downloading.
                    </p>
                  )}
                  {actionError && !bootstrapOpen && confirm === null && (
                    <p className="text-xs text-destructive">{actionError}</p>
                  )}
                </div>
              )}

              <RecentTicksTable
                hasData={Boolean(selected?.dataset)}
                loading={ticksQ.isLoading}
                error={ticksQ.isError ? String(ticksQ.error) : null}
                rows={ticksQ.data?.rows ?? []}
                total={ticksQ.data?.total ?? 0}
              />

              {hasJob && (
                <JobConsole
                  job={jobQ.data}
                  loading={Boolean(jobId) && jobQ.isLoading}
                  onCancel={() => jobId && cancelJob.mutate(jobId)}
                  cancelling={cancelJob.isPending}
                />
              )}
            </>
          )}
        </section>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "update-all"
                ? "Update all symbols?"
                : `Update ${symbol}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "update-all"
                ? `This will download new ticks for all ${withData} symbols already on disk, from each last tick forward. Continue?`
                : `This will download new ticks for ${symbol} from its last tick forward. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={createJob.isPending}>
              No
            </AlertDialogClose>
            <AlertDialogAction
              disabled={createJob.isPending}
              onClick={confirmUpdate}
            >
              Yes, update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bootstrapOpen} onOpenChange={setBootstrapOpen}>
        <AlertDialogContent className="w-[min(100vw-2rem,26rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              New dataset · {symbol || "symbol"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Download historical ticks for this symbol. Leave To empty for
              today. After the first download, use Update to fill forward.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                From
              </span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={jobBusy}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                To (optional)
              </span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={jobBusy}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={jobBusy}
                className="size-3.5 accent-blue-800"
              />
              Force overwrite existing days
            </label>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogClose disabled={createJob.isPending}>
              Cancel
            </AlertDialogClose>
            <AlertDialogAction
              className="bg-blue-800 text-white hover:bg-blue-800/90 dark:bg-blue-700"
              disabled={!inMarketHours || !fromDate || jobBusy}
              onClick={runBootstrap}
            >
              <Plus className="size-3.5" />
              Download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function splitTickTime(value: string): { date: string; time: string } {
  const trimmed = value.trim()
  const space = trimmed.indexOf(" ")
  if (space <= 0) return { date: trimmed, time: "" }
  return {
    date: trimmed.slice(0, space),
    time: trimmed.slice(space + 1),
  }
}

function RecentTicksTable({
  hasData,
  loading,
  error,
  rows,
  total,
}: {
  hasData: boolean
  loading: boolean
  error: string | null
  rows: {
    timestamp_ms: number
    time_utc: string
    time_broker: string
    side: string
    price: number
    symbol: string
  }[]
  total: number
}) {
  if (!hasData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-muted-foreground">
          No ticks on disk yet. Use{" "}
          <span className="font-medium">New dataset</span> to download history.
        </p>
      </div>
    )
  }

  const rowGrid =
    "grid grid-cols-4 items-center gap-x-6 px-4"

  if (loading) {
    return (
      <LoadingState
        title="Loading ticks"
        message="Fetching recent tick rows…"
      />
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-medium tracking-tight">Recent ticks</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {rows.length.toLocaleString()}
            {total > rows.length ? ` of ${total.toLocaleString()}` : ""} shown
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
          <span>UTC</span>
          <span>Broker</span>
          <span className="text-center">Side</span>
          <span className="text-right">Price</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
            No ticks found.
          </div>
        ) : (
          rows.map((row, i) => {
            const utc = splitTickTime(row.time_utc)
            const broker = splitTickTime(row.time_broker)
            const isBid = row.side === "BID"
            return (
              <div
                key={`${row.timestamp_ms}-${row.side}-${row.price}`}
                className={cn(
                  rowGrid,
                  "border-b border-border/50 py-2.5 transition-colors hover:bg-sky-500/[0.06]",
                  i % 2 === 1 && "bg-muted/20",
                )}
              >
                <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
                  <span className="shrink-0 text-muted-foreground">
                    {utc.date}
                  </span>
                  <span className="font-medium text-foreground">{utc.time}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                  <span className="shrink-0">{broker.date}</span>
                  <span>{broker.time}</span>
                </div>
                <div className="flex justify-center">
                  <span
                    className={cn(
                      "inline-flex min-w-[2.25rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                      isBid
                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {isBid ? "Bid" : "Ask"}
                  </span>
                </div>
                <span className="text-right font-mono text-[13px] font-semibold tabular-nums tracking-tight text-foreground">
                  {row.price}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function JobConsole({
  job,
  loading,
  onCancel,
  cancelling,
}: {
  job?: TickJob
  loading: boolean
  onCancel: () => void
  cancelling: boolean
}) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [job?.log.length, job?.status])

  if (loading) {
    return (
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border px-4 py-6">
        <Spinner className="size-4 text-rose-500" />
        <span className="text-xs text-muted-foreground">Loading job…</span>
      </div>
    )
  }

  if (!job) return null

  const active = job.status === "running" || job.status === "queued"

  return (
    <div className="flex max-h-48 shrink-0 flex-col border-t border-border">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Job</span>
          <span
            className={cn(
              "text-[10px] font-semibold tracking-wider uppercase",
              statusTone(job.status),
            )}
          >
            {job.status}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {job.cmd}
            {job.symbol ? ` · ${job.symbol}` : " · all"}
          </span>
        </div>
        {active && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={cancelling}
            onClick={onCancel}
          >
            <Square className="size-3" />
            Cancel
          </Button>
        )}
      </div>
      {job.error && (
        <p className="shrink-0 bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
          {job.error}
        </p>
      )}
      <pre
        ref={logRef}
        className="max-h-32 overflow-auto bg-zinc-950 px-4 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 dark:bg-black/40"
      >
        {(job.log.length ? job.log : ["Waiting for output…"]).join("\n")}
      </pre>
    </div>
  )
}
