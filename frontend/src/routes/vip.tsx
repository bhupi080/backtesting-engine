import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Crown,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  ZoomIn,
} from "lucide-react"

import { EquityCurveZoomModal, PreciseEquityCurveChart } from "@/components/charts"
import { LoadingState } from "@/components/loading-state"
import { SimOverviewPanel } from "@/components/sim-overview-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type SimulateResponse, type StrategyInfo, type VipLine } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  DeferredTradeEquityChart,
  SimAnalyticsPanel,
} from "@/routes/simulate"

export const Route = createFileRoute("/vip")({
  component: VipPage,
})

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Bucharest", label: "Bucharest" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
]

const ATR_BARS = [
  { value: "1", label: "1 min" },
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hour" },
]

const EXIT_LABEL: Record<string, string> = {
  tp: "Take profit",
  sl: "Stop",
  signal: "CSV exit",
}

type TabId = "overview" | "analytics" | "trades" | "grid"

function blankLine(): VipLine {
  return {
    id: crypto.randomUUID(),
    symbol: "",
    strategy_id: "",
    atr_bar_minutes: 60,
    atr_period: 14,
    tp_atr_mult: 2,
    sl_atr_mult: 1,
    lots: 0.1,
    commission_per_lot: 7,
    starting_balance: 2000,
    chart_tf_minutes: 0,
  }
}

function formatPnl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return "text-muted-foreground"
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400"
}

function formatMult(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function atrLabel(minutes: number): string {
  return ATR_BARS.find((bar) => Number(bar.value) === minutes)?.label ?? `${minutes} min`
}

function VipPage() {
  const queryClient = useQueryClient()
  const vipsQ = useQuery({ queryKey: ["vips"], queryFn: api.vips })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [timeZone, setTimeZone] = useState("Europe/Bucharest")
  const [chartTf, setChartTf] = useState(10)
  const [fillGroup, setFillGroup] = useState<"signal" | "barClose">("signal")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tab, setTab] = useState<TabId>("overview")
  const [editor, setEditor] = useState<VipLine | null>(null)
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [ranLines, setRanLines] = useState("")

  const vip = useMemo(() => {
    const rows = vipsQ.data ?? []
    return rows.find((row) => row.id === selectedId) ?? rows[0] ?? null
  }, [vipsQ.data, selectedId])

  useEffect(() => {
    setName(vip?.name ?? "")
  }, [vip?.id, vip?.name])

  const save = useMutation({
    mutationFn: (body: { id: string; name?: string; lines?: VipLine[] }) =>
      api.updateVip(body.id, { name: body.name, lines: body.lines }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })

  const create = useMutation({
    mutationFn: (label: string) => api.createVip(label),
    onSuccess: async (created) => {
      setNewName("")
      setSelectedId(created.id)
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteVip(id),
    onSuccess: async () => {
      setSelectedId(null)
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })

  const run = useMutation({
    mutationFn: async () => {
      if (!vip) throw new Error("Create a VIP first")
      await api.updateVip(vip.id, { name: name.trim() || vip.name, lines: vip.lines })
      return api.runVip(vip.id, chartTf, timeZone)
    },
    onSuccess: () => {
      setRanLines(JSON.stringify({ lines: vip?.lines ?? [], chartTf }))
      setFillGroup(chartTf > 0 ? "barClose" : "signal")
    },
  })

  const stale = Boolean(run.data) && ranLines !== JSON.stringify({ lines: vip?.lines ?? [], chartTf })
  const showBarClose = Boolean(run.data?.bar_close) && fillGroup === "barClose"
  const combined = showBarClose ? run.data?.bar_close : run.data?.signal
  const summary = combined?.summary
  const startingBalance = combined?.settings?.starting_balance ?? 0
  const chartEquity = useMemo(
    () =>
      (combined?.equity ?? []).map((point) => ({
        t: point.t,
        equity: point.equity - startingBalance,
        drawdown: point.drawdown,
        exitReason: point.exit_reason,
      })),
    [combined?.equity, startingBalance],
  )
  function persistLines(lines: VipLine[]) {
    if (!vip) return
    save.mutate({ id: vip.id, lines })
  }

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background/60 lg:flex-row">
        <aside
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden border-border bg-muted/20",
            "max-lg:border-b lg:border-r",
            sidebarOpen ? "max-h-[46%] w-full lg:max-h-none lg:w-80" : "max-h-0 lg:w-0",
          )}
        >
          <div className="flex h-full w-full min-w-0 flex-1 flex-col lg:min-w-80">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                VIP accounts
              </p>
              <button type="button" onClick={() => setSidebarOpen(false)} className="text-muted-foreground">
                <PanelLeftClose className="size-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Create VIP
                </span>
                <div className="flex gap-1.5">
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="Account name"
                    className="h-8 text-[12px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newName.trim() || create.isPending}
                    onClick={() => create.mutate(newName.trim())}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
              {(vipsQ.data ?? []).length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No VIP accounts yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    Open account
                  </span>
                  <ul className="space-y-1">
                    {(vipsQ.data ?? []).map((row) => {
                      const selected = row.id === vip?.id
                      return (
                        <li key={row.id}>
                          {selected && renaming ? (
                            <Input
                              autoFocus
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              onBlur={() => {
                                const next = name.trim()
                                if (next && next !== row.name) save.mutate({ id: row.id, name: next })
                                setRenaming(false)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur()
                              }}
                              className="h-8 text-[12px]"
                            />
                          ) : (
                            <div
                              className={cn(
                                "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                                selected ? "border-amber-500/50 bg-amber-500/10" : "bg-background",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setRenaming(false)
                                  setSelectedId(row.id)
                                }}
                                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium"
                              >
                                {row.name}
                              </button>
                              {selected ? (
                                <button
                                  type="button"
                                  title="Rename"
                                  className="text-muted-foreground"
                                  onClick={() => setRenaming(true)}
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              ) : null}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {vip ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      Timezone
                    </span>
                    <Select value={timeZone} onValueChange={(value) => value && setTimeZone(value)}>
                      <SelectTrigger className="h-8 w-full text-[12px]">
                        <SelectValue>
                          {TIMEZONES.find((zone) => zone.value === timeZone)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((zone) => (
                          <SelectItem key={zone.value} value={zone.value}>
                            {zone.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <NumberField
                    label="Chart TF (min)"
                    value={chartTf}
                    step={1}
                    min={0}
                    onChange={setChartTf}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Symbols
                    </p>
                    <Button type="button" size="xs" variant="outline" onClick={() => setEditor(blankLine())}>
                      <Plus className="size-3" />
                      Add symbol
                    </Button>
                  </div>
                  <ul className="space-y-1.5">
                    {vip.lines.map((line) => (
                      <li key={line.id} className="rounded-md border bg-background px-2.5 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[12px] font-semibold">
                              {line.symbol}
                              <span className="ml-1.5 font-sans text-[10px] font-medium text-muted-foreground">
                                {line.strategy_id}
                              </span>
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              TP ×{formatMult(line.tp_atr_mult)} · SL ×{formatMult(line.sl_atr_mult)} ·{" "}
                              {atrLabel(line.atr_bar_minutes)}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-0.5">
                            <button type="button" className="text-muted-foreground" onClick={() => setEditor(line)}>
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground"
                              onClick={() => persistLines(vip.lines.filter((row) => row.id !== line.id))}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete ${vip.name}?`)) remove.mutate(vip.id)
                    }}
                  >
                    Delete this VIP
                  </Button>
                </>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <Button
                type="button"
                className="w-full"
                disabled={!vip || vip.lines.length === 0 || run.isPending}
                onClick={() => run.mutate()}
              >
                <Play className="size-3.5" />
                {run.isPending ? "Running…" : "Run"}
              </Button>
              {save.error || create.error || run.error ? (
                <p className="mt-2 text-[11px] text-rose-500">
                  {(save.error ?? create.error ?? run.error)?.message}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!sidebarOpen ? (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="m-2 inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground"
            >
              <PanelLeftOpen className="size-3.5" />
            </button>
          ) : null}
          {run.isPending ? (
            <LoadingState
              title="Running VIP"
              message={
                chartTf > 0
                  ? `Filling each symbol at the signal and after the ${chartTf}m bar, then adding the results.`
                  : "Filling each symbol at the signal, then adding the results."
              }
            />
          ) : !run.data || !summary || !combined ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Crown className="size-8 text-amber-500/60" />
              <p className="text-sm font-medium">Add symbols to this VIP</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Each symbol keeps its own strategy, ATR take profit and stop, and lot size. Run compares a fill at the signal with a fill at bar close.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-2 border-b border-border px-3 py-2 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{run.data.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {run.data.lines.length} {run.data.lines.length === 1 ? "symbol" : "symbols"}
                    {stale ? " · settings changed, run again" : ""}
                  </p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:w-[22rem]">
                  <FillGroupCard
                    active={!showBarClose}
                    title="At signal"
                    tfLabel="0m"
                    pnl={run.data.signal.summary?.sim_pnl_usd}
                    onClick={() => setFillGroup("signal")}
                  />
                  {run.data.bar_close ? (
                    <FillGroupCard
                      active={showBarClose}
                      title="Bar close"
                      tfLabel={`${run.data.chart_tf_minutes}m`}
                      pnl={run.data.bar_close.summary?.sim_pnl_usd}
                      onClick={() => setFillGroup("barClose")}
                    />
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2">
                {(
                  [
                    ["overview", "Overview"],
                    ["analytics", "Analytics"],
                    ["trades", "Trades"],
                    ["grid", "Equity by trade"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "relative shrink-0 px-3 py-1.5 text-[11px] font-medium",
                      tab === id ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {label}
                    {tab === id ? (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-amber-500" />
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "overview" ? (
                  <div className="flex flex-col">
                    <SimOverviewPanel
                      summary={summary}
                      equity={chartEquity}
                      trades={combined.trades}
                      timeZone={timeZone}
                    />
                    <div className="px-3 pt-3">
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        By symbol
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
                      {run.data.lines.map((row) => {
                        const result = showBarClose ? row.bar_close : row.signal
                        const balance = result?.settings?.starting_balance ?? row.line.starting_balance
                        const equity = (result?.equity ?? []).map((point) => ({
                          t: point.t,
                          equity: point.equity - balance,
                          drawdown: point.drawdown,
                          exitReason: point.exit_reason,
                        }))
                        const pnl = result?.summary?.sim_pnl_usd
                        const trades = result?.trades ?? []
                        const filled = trades.filter((trade) => trade.status === "ok").length
                        const missingTicks = trades.some((trade) => trade.status === "no_ticks")
                        const emptyReason = row.error
                          ? row.error
                          : filled > 0
                            ? null
                            : missingTicks
                              ? `No tick data for ${row.line.symbol}, so these trades were not filled.`
                              : trades.length === 0
                                ? `No trades saved for ${row.line.symbol} ${row.line.strategy_id}.`
                                : "No trades were filled."
                        return (
                          <div key={row.line.id} className="rounded-md border bg-card p-3">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <p className="font-mono text-sm font-semibold">
                                  {row.line.symbol}
                                  <span className="ml-1.5 font-sans text-[11px] font-medium text-muted-foreground">
                                    Strategy {row.line.strategy_id}
                                  </span>
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  ATR {row.line.atr_period} on {atrLabel(row.line.atr_bar_minutes)} · Take profit ×
                                  {formatMult(row.line.tp_atr_mult)} · Stop ×{formatMult(row.line.sl_atr_mult)} ·{" "}
                                  {row.line.lots} lots
                                </p>
                              </div>
                              <p className={cn("font-mono text-sm font-semibold tabular-nums", pnlClass(filled > 0 ? pnl : null))}>
                                {filled > 0 ? formatPnl(pnl) : "Not filled"}
                              </p>
                            </div>
                            {emptyReason ? (
                              <p className="flex h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                                {emptyReason}
                              </p>
                            ) : (
                              <PreciseEquityCurveChart
                                equity={equity}
                                timeZone={timeZone}
                                className="h-44"
                                allowZoom
                                showExtremumStats
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : tab === "analytics" ? (
                  <SimAnalyticsPanel
                    summary={summary}
                    trades={combined.trades}
                    equity={chartEquity}
                    timeZone={timeZone}
                  />
                ) : tab === "grid" ? (
                  <EquityGrid rows={combined.trades} tradeEquity={combined.trade_equity ?? {}} timeZone={timeZone} />
                ) : (
                  <TradesTable rows={combined.trades} tradeEquity={combined.trade_equity ?? {}} timeZone={timeZone} />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      {editor && vip ? (
        <LineDialog
          line={editor}
          onClose={() => setEditor(null)}
          onSave={(next) => {
            const exists = vip.lines.some((row) => row.id === next.id)
            persistLines(exists ? vip.lines.map((row) => (row.id === next.id ? next : row)) : [...vip.lines, next])
            setEditor(null)
          }}
        />
      ) : null}
    </div>
  )
}

function FillGroupCard({
  active,
  title,
  tfLabel,
  pnl,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  pnl: number | null | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-1.5 text-left transition-all",
        active
          ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[10px] font-medium text-muted-foreground">
          {title}
          <span className="ml-1 font-mono tabular-nums">· {tfLabel}</span>
        </span>
        {active ? (
          <span className="shrink-0 rounded bg-amber-600/90 px-1 py-px text-[8px] font-semibold tracking-wide text-white uppercase">
            On
          </span>
        ) : null}
      </div>
      <p className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", pnlClass(pnl))}>
        {formatPnl(pnl)}
      </p>
    </button>
  )
}

function LineDialog({
  line,
  onClose,
  onSave,
}: {
  line: VipLine
  onClose: () => void
  onSave: (line: VipLine) => void
}) {
  const [draft, setDraft] = useState(line)
  const [pickerOpen, setPickerOpen] = useState(!line.symbol)
  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: api.strategies })
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (strategiesQ.data ?? []).filter(
      (row) => !q || row.symbol.toLowerCase().includes(q) || row.strategy_id.toLowerCase().includes(q),
    )
    const map = new Map<string, StrategyInfo[]>()
    for (const row of rows) {
      map.set(row.symbol, [...(map.get(row.symbol) ?? []), row])
    }
    return [...map.entries()]
      .map(([symbol, strategies]) => ({ symbol, strategies }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [query, strategiesQ.data])

  function setNumber<K extends keyof VipLine>(key: K, value: number) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{line.symbol ? "Edit symbol" : "Add symbol"}</DialogTitle>
          <DialogDescription>
            Strategy, ATR take profit and stop, and position size. Fill time is chosen for the whole VIP.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-5">
          <div>
            <p className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Symbol and strategy
            </p>
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm font-semibold">
                  {draft.symbol || "Choose a symbol"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {draft.strategy_id ? `Strategy ${draft.strategy_id}` : "Then choose its strategy"}
                </span>
              </span>
              <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground", !pickerOpen && "-rotate-90")} />
            </button>
            {pickerOpen ? (
              <div className="mt-2 rounded-md border">
                <div className="relative border-b">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-9 border-0 pl-8 text-[12px] shadow-none"
                    placeholder="Search symbol or strategy"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {groups.map((group) => {
                    const open = expanded[group.symbol] ?? group.symbol === draft.symbol
                    return (
                      <div key={group.symbol}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                          onClick={() => setExpanded((prev) => ({ ...prev, [group.symbol]: !open }))}
                        >
                          <ChevronDown className={cn("size-3.5 text-muted-foreground", !open && "-rotate-90")} />
                          <span className="font-mono text-[12px] font-semibold">{group.symbol}</span>
                        </button>
                        {open
                          ? group.strategies.map((strategy) => (
                              <button
                                key={`${strategy.symbol}-${strategy.strategy_id}`}
                                type="button"
                                className="block w-full px-8 py-1.5 text-left text-[12px] hover:bg-muted/50"
                                onClick={() => {
                                  setDraft((prev) => ({
                                    ...prev,
                                    symbol: strategy.symbol,
                                    strategy_id: strategy.strategy_id,
                                  }))
                                  setPickerOpen(false)
                                }}
                              >
                                {strategy.strategy_id}
                              </button>
                            ))
                          : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              ATR take profit and stop
            </p>
            <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">ATR bar</span>
              <Select
                value={String(draft.atr_bar_minutes)}
                onValueChange={(value) => value && setNumber("atr_bar_minutes", Number(value))}
              >
                <SelectTrigger className="h-8 w-full text-[12px]">
                  <SelectValue>{atrLabel(draft.atr_bar_minutes)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ATR_BARS.map((bar) => (
                    <SelectItem key={bar.value} value={bar.value}>
                      {bar.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <NumberField label="ATR length" value={draft.atr_period} step={1} min={2} onChange={(n) => setNumber("atr_period", n)} />
            <NumberField label="Take profit × ATR" value={draft.tp_atr_mult} step={0.1} min={0.1} onChange={(n) => setNumber("tp_atr_mult", n)} />
            <NumberField label="Stop × ATR" value={draft.sl_atr_mult} step={0.1} min={0.1} onChange={(n) => setNumber("sl_atr_mult", n)} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Position size
            </p>
            <div className="grid grid-cols-2 gap-3">
            <NumberField label="Lots" value={draft.lots} step={0.01} min={0.01} onChange={(n) => setNumber("lots", n)} />
            <NumberField label="Commission / lot" value={draft.commission_per_lot} step={0.5} min={0} onChange={(n) => setNumber("commission_per_lot", n)} />
            <NumberField label="Starting balance" value={draft.starting_balance} step={100} min={100} onChange={(n) => setNumber("starting_balance", n)} />
            </div>
          </div>
        </div>
        <DialogFooter className="mt-6 flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!draft.symbol || !draft.strategy_id} onClick={() => onSave(draft)}>
            Save symbol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <Input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 font-mono text-[12px]"
      />
    </label>
  )
}

function levelsFor(trade: SimulateResponse["trades"][number]) {
  return [
    trade.tp_pnl_usd != null
      ? { y: trade.tp_pnl_usd, label: `TP hit ${formatPnl(trade.tp_pnl_usd)}`, color: "#22c55e" }
      : null,
    trade.sl_pnl_usd != null
      ? { y: trade.sl_pnl_usd, label: `SL hit ${formatPnl(trade.sl_pnl_usd)}`, color: "#ef4444" }
      : null,
  ].filter((level): level is { y: number; label: string; color: string } => level != null)
}

function csvExitMarker(path: { t: string; equity: number }[]) {
  const last = path[path.length - 1]
  if (!last) return undefined
  return [{ t: last.t, y: last.equity, label: `CSV exit ${formatPnl(last.equity)}`, color: "#f59e0b" }]
}

function EquityGrid({
  rows,
  tradeEquity,
  timeZone,
}: {
  rows: SimulateResponse["trades"]
  tradeEquity: Record<string, { t: string; equity: number; drawdown: number }[]>
  timeZone: string
}) {
  const filled = rows.filter((row) => row.status === "ok" && row.net_pnl_usd != null)
  if (filled.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No filled trades to chart.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {filled.map((trade) => {
        const path = tradeEquity[String(trade.trade_id)] ?? []
        const reason = trade.exit_reason ?? "signal"
        return (
          <div key={trade.trade_id} className="rounded-md border bg-card p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] font-semibold">
                  {trade.symbol} · {trade.strategy_id}
                </p>
                <div className="mt-0.5 flex items-center gap-1">
                  <Badge variant="secondary">{trade.side}</Badge>
                  <span className="text-[10px] text-muted-foreground">{EXIT_LABEL[reason] ?? reason}</span>
                </div>
              </div>
              <span className={cn("font-mono text-xs font-semibold tabular-nums", pnlClass(trade.net_pnl_usd))}>
                {formatPnl(trade.net_pnl_usd)}
              </span>
            </div>
            <DeferredTradeEquityChart
              equity={path}
              sessionBands={[]}
              timeZone={timeZone}
              domain={undefined}
              levels={levelsFor(trade)}
              markers={csvExitMarker(path)}
              guideLabels
              plain
              title={`${trade.symbol} ${trade.strategy_id}`}
              subtitle={EXIT_LABEL[reason] ?? reason}
            />
          </div>
        )
      })}
    </div>
  )
}

function TradesTable({
  rows,
  tradeEquity,
  timeZone,
}: {
  rows: SimulateResponse["trades"]
  tradeEquity: Record<string, { t: string; equity: number; drawdown: number }[]>
  timeZone: string
}) {
  const [zoomedId, setZoomedId] = useState<number | null>(null)
  const zoomed = rows.find((row) => row.trade_id === zoomedId) ?? null
  const path = zoomedId != null ? (tradeEquity[String(zoomedId)] ?? []) : []
  return (
    <div className="p-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Exit</TableHead>
            <TableHead className="text-right">Net PnL</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows
            .filter((row) => row.status === "ok")
            .map((row) => (
              <TableRow key={row.trade_id}>
                <TableCell className="font-mono text-xs">{row.symbol}</TableCell>
                <TableCell className="text-xs">{row.strategy_id}</TableCell>
                <TableCell className="text-xs">{row.side}</TableCell>
                <TableCell className="text-xs">{EXIT_LABEL[row.exit_reason ?? "signal"] ?? row.exit_reason}</TableCell>
                <TableCell className={cn("text-right font-mono text-xs tabular-nums", pnlClass(row.net_pnl_usd))}>
                  {formatPnl(row.net_pnl_usd)}
                </TableCell>
                <TableCell className="text-right">
                  <button type="button" onClick={() => setZoomedId(row.trade_id)} className="text-muted-foreground">
                    <ZoomIn className="size-3.5" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <EquityCurveZoomModal
        open={zoomed != null}
        onClose={() => setZoomedId(null)}
        equity={path}
        timeZone={timeZone}
        title={zoomed ? `${zoomed.symbol} ${zoomed.strategy_id}` : "Trade"}
        subtitle={zoomed ? (EXIT_LABEL[zoomed.exit_reason ?? "signal"] ?? "") : ""}
        levels={zoomed ? levelsFor(zoomed) : undefined}
        markers={csvExitMarker(path)}
      />
    </div>
  )
}
