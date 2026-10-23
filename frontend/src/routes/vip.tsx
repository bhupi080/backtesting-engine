import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  Crown,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react"

import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts"

import { PreciseEquityCurveChart } from "@/components/charts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { LoadingState } from "@/components/loading-state"
import { SimOverviewPanel } from "@/components/sim-overview-panel"
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
  api,
  type AccountTargetHit,
  type StrategyInfo,
  type VipAccount,
  type VipLine,
  type VipRun,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  getSelectedVipId,
  getVipExplorerBuild,
  saveSelectedVipId,
  saveVipExplorerBuild,
} from "@/lib/run-session"
import {
  SimAnalyticsPanel,
  SimTradesTable,
} from "@/routes/simulate"

export const Route = createFileRoute("/vip")({
  component: VipRoute,
})

function VipRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (pathname !== "/vip") return <Outlet />
  return <VipPage />
}

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

const LINE_COLORS = [
  "#34d399",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#facc15",
]

type TabId = "overview" | "analytics" | "trades"

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
    chart_tf_minutes: 10,
    exit_mode: "atr",
  }
}

function exitSummary(line: VipLine): string {
  const exit = line.exit_mode === "csv"
    ? "CSV exit"
    : `TP ×${formatMult(line.tp_atr_mult)} · SL ×${formatMult(line.sl_atr_mult)} · ${atrLabel(line.atr_bar_minutes)}`
  return `${exit} · ${barCloseSummary(line)}`
}

function barCloseSummary(line: Pick<VipLine, "chart_tf_minutes">): string {
  return line.chart_tf_minutes > 0 ? `Bar close ${line.chart_tf_minutes}m` : "At signal"
}

function barCloseCardLabel(lines: VipLine[]): string {
  const minutes = [...new Set(lines.map((line) => line.chart_tf_minutes).filter((minutes) => minutes > 0))]
  return minutes.length === 1 ? `${minutes[0]}m` : "per symbol"
}

function formatPnl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTarget(n: number): string {
  const abs = Math.abs(n)
  return Number.isInteger(abs)
    ? abs.toLocaleString()
    : abs.toLocaleString(undefined, { maximumFractionDigits: 2 })
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

function setupKey(
  lines: VipLine[],
  balance: number,
  targetsOn: boolean,
  accountTp: number,
  accountSl: number,
) {
  return JSON.stringify({
    lines,
    balance,
    targetsOn,
    accountTp: targetsOn ? accountTp : null,
    accountSl: targetsOn ? accountSl : null,
  })
}

function targetSentence(hit: AccountTargetHit | null | undefined): string {
  if (!hit) return ""
  if (hit.hit === "tp") return `Took profit at ${formatPnl(hit.profit)}`
  if (hit.hit === "sl") return `Stopped at ${formatPnl(hit.profit)}`
  return `Ended at ${formatPnl(hit.profit)}`
}

function atrLabel(minutes: number): string {
  return ATR_BARS.find((bar) => Number(bar.value) === minutes)?.label ?? `${minutes} min`
}

function VipPage() {
  const queryClient = useQueryClient()
  const vipsQ = useQuery({ queryKey: ["vips"], queryFn: api.vips })
  const [selectedId, setSelectedId] = useState<string | null>(getSelectedVipId())
  const [name, setName] = useState("")
  const [timeZone, setTimeZone] = useState("Europe/Bucharest")
  const [balance, setBalance] = useState(2000)
  const [targetsOn, setTargetsOn] = useState(false)
  const [accountTp, setAccountTp] = useState(1000)
  const [accountSl, setAccountSl] = useState(500)
  const [fillGroup, setFillGroup] = useState<"signal" | "barClose">("signal")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tab, setTab] = useState<TabId>("overview")
  const [tradeLineId, setTradeLineId] = useState<string | null>(null)
  const [editor, setEditor] = useState<VipLine | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [ranLines, setRanLines] = useState("")

  const vip = useMemo(() => {
    const rows = vipsQ.data ?? []
    return rows.find((row) => row.id === selectedId) ?? rows[0] ?? null
  }, [vipsQ.data, selectedId])

  useEffect(() => {
    setName(vip?.name ?? "")
    setBalance(vip?.starting_balance ?? 2000)
    setTargetsOn(Boolean(vip?.account_targets_enabled))
    setAccountTp(vip?.account_tp_usd ?? 1000)
    setAccountSl(vip?.account_sl_usd ?? 500)
  }, [
    vip?.id,
    vip?.name,
    vip?.starting_balance,
    vip?.account_targets_enabled,
    vip?.account_tp_usd,
    vip?.account_sl_usd,
  ])

  useEffect(() => {
    setTradeLineId(null)
    if (vip?.id) saveSelectedVipId(vip.id)
  }, [vip?.id])

  const save = useMutation({
    mutationFn: (body: {
      id: string
      name?: string
      lines?: VipLine[]
      starting_balance?: number
      account_targets_enabled?: boolean
      account_tp_usd?: number
      account_sl_usd?: number
    }) =>
      api.updateVip(body.id, {
        name: body.name,
        lines: body.lines,
        starting_balance: body.starting_balance,
        account_targets_enabled: body.account_targets_enabled,
        account_tp_usd: body.account_tp_usd,
        account_sl_usd: body.account_sl_usd,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })

  const create = useMutation({
    mutationFn: (label: string) => api.createVip(label),
    onSuccess: async (created) => {
      setSelectedId(created.id)
      setAccountOpen(false)
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
      await api.updateVip(vip.id, {
        name: name.trim() || vip.name,
        lines: vip.lines,
        starting_balance: balance,
        account_targets_enabled: targetsOn,
        ...(accountTp > 0 ? { account_tp_usd: accountTp } : {}),
        ...(accountSl > 0 ? { account_sl_usd: accountSl } : {}),
      })
      return api.runVip(vip.id, timeZone)
    },
    onSuccess: () => {
      setRanLines(setupKey(vip?.lines ?? [], balance, targetsOn, accountTp, accountSl))
      setFillGroup((vip?.lines ?? []).some((line) => line.chart_tf_minutes > 0) ? "barClose" : "signal")
    },
  })

  const accountIds = new Set((vipsQ.data ?? []).map((row) => row.id))
  const visibleRun = run.data && accountIds.has(run.data.vip_id) ? run.data : null
  const stale =
    Boolean(visibleRun) &&
    ranLines !== setupKey(vip?.lines ?? [], balance, targetsOn, accountTp, accountSl)
  const targetsReady = !targetsOn || (accountTp > 0 && accountSl > 0)
  const showBarClose = Boolean(visibleRun?.bar_close) && fillGroup === "barClose"
  const combined = showBarClose ? visibleRun?.bar_close : visibleRun?.signal
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

  function persistTargets(next: { enabled: boolean; tp: number; sl: number }) {
    if (!vip) return
    if (next.enabled && (next.tp <= 0 || next.sl <= 0)) return
    save.mutate({
      id: vip.id,
      account_targets_enabled: next.enabled,
      ...(next.tp > 0 ? { account_tp_usd: next.tp } : {}),
      ...(next.sl > 0 ? { account_sl_usd: next.sl } : {}),
    })
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
              <div>
                <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Account
                </p>
                <button
                  type="button"
                  onClick={() => setAccountOpen(true)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {vip?.name ?? "No account open"}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {vipsQ.isLoading
                        ? "Loading accounts…"
                        : vip
                          ? `${vip.lines.length} ${vip.lines.length === 1 ? "symbol" : "symbols"}`
                          : "Create or open an account"}
                    </span>
                  </span>
                  <Crown className="size-3.5 shrink-0 text-amber-500" />
                </button>
              </div>

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
                    label="Starting balance"
                    value={balance}
                    step={100}
                    min={100}
                    onChange={setBalance}
                    onBlur={() => {
                      if (!vip || balance === vip.starting_balance) return
                      save.mutate({ id: vip.id, starting_balance: balance })
                    }}
                  />
                  <label className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-amber-500"
                      checked={targetsOn}
                      onChange={(event) => {
                        const next = event.target.checked
                        setTargetsOn(next)
                        persistTargets({ enabled: next, tp: accountTp, sl: accountSl })
                      }}
                    />
                    Account take profit and stop
                  </label>
                  {targetsOn ? (
                    <>
                      <NumberField
                        label="Take profit $"
                        value={accountTp}
                        step={100}
                        min={1}
                        onChange={setAccountTp}
                        onBlur={() => persistTargets({ enabled: true, tp: accountTp, sl: accountSl })}
                      />
                      <NumberField
                        label="Stop $"
                        value={accountSl}
                        step={100}
                        min={1}
                        onChange={setAccountSl}
                        onBlur={() => persistTargets({ enabled: true, tp: accountTp, sl: accountSl })}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Both are required. Stop is a loss, so 500 closes the account at −500.
                      </p>
                    </>
                  ) : null}
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
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{exitSummary(line)}</p>
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
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Open an account to add symbols and run them together.
                </p>
              )}
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <Button
                type="button"
                className="w-full"
                disabled={!vip || vip.lines.length === 0 || run.isPending || !targetsReady}
                onClick={() => run.mutate()}
              >
                <Play className="size-3.5" />
                {run.isPending ? "Running…" : "Run"}
              </Button>
              {save.error || create.error || run.error ? (
                <p className="mt-2 text-[11px] text-rose-500">
                  {(save.error ?? create.error ?? run.error)?.message}
                </p>
              ) : !targetsReady ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Enter a take profit and a stop above zero.
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
              message="Filling each symbol at the signal, and at that symbol's bar close when it has one."
            />
          ) : !vip ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Crown className="size-8 text-amber-500/60" />
              <p className="text-sm font-medium">Open a VIP account</p>
              <p className="max-w-md text-sm text-muted-foreground">
                An account holds the symbols you want to trade together.
              </p>
              <Button type="button" onClick={() => setAccountOpen(true)}>
                Open account
              </Button>
            </div>
          ) : !visibleRun || !summary || !combined ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Crown className="size-8 text-amber-500/60" />
              <p className="text-sm font-medium">
                {vip.lines.length === 0 ? `Add symbols to ${vip.name}` : `Run ${vip.name}`}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {vip.lines.length === 0
                  ? "Each symbol keeps its own strategy, exit, and lot size."
                  : "Run compares a fill at the signal with a fill at bar close."}
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-2 border-b border-border px-3 py-2 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{visibleRun.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {visibleRun.lines.length} {visibleRun.lines.length === 1 ? "symbol" : "symbols"}
                    {stale ? " · settings changed, run again" : ""}
                  </p>
                  {visibleRun.account_target?.enabled ? (
                    <p className="text-[11px] text-muted-foreground">
                      Take profit {formatPnl(visibleRun.account_target.take_profit)} · stop{" "}
                      {formatPnl(-visibleRun.account_target.stop)}
                      {" · "}
                      {targetSentence(
                        showBarClose ? visibleRun.account_target.bar_close : visibleRun.account_target.signal,
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:w-[22rem]">
                  <FillGroupCard
                    active={!showBarClose}
                    title="At signal"
                    tfLabel="0m"
                    pnl={visibleRun.signal.summary?.sim_pnl_usd}
                    recommended
                    onClick={() => setFillGroup("signal")}
                  />
                  {visibleRun.bar_close ? (
                    <FillGroupCard
                      active={showBarClose}
                      title="Bar close"
                      tfLabel={barCloseCardLabel(visibleRun.lines.map((row) => row.line))}
                      pnl={visibleRun.bar_close.summary?.sim_pnl_usd}
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
                    <SymbolOverlay
                      lines={visibleRun.lines}
                      showBarClose={showBarClose}
                      timeZone={timeZone}
                    />
                    <div className="px-3 pt-3">
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        By symbol
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
                      {visibleRun.lines.map((row) => {
                        const result = showBarClose ? row.bar_close : row.signal
                        const balance = result?.settings?.starting_balance ?? 0
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
                        const signalOnly = showBarClose && row.line.chart_tf_minutes <= 0
                        const emptyReason = signalOnly
                          ? `${row.line.symbol} is filled at the signal only.`
                          : row.error
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
                                  {row.line.exit_mode === "csv"
                                    ? "CSV exit"
                                    : `ATR ${row.line.atr_period} on ${atrLabel(row.line.atr_bar_minutes)} · Take profit ×${formatMult(row.line.tp_atr_mult)} · Stop ×${formatMult(row.line.sl_atr_mult)}`}
                                  {" · "}
                                  {row.line.lots} lots
                                  {" · "}
                                  {barCloseSummary(row.line)}
                                </p>
                              </div>
                              <p className={cn("font-mono text-sm font-semibold tabular-nums", pnlClass(filled > 0 ? pnl : null))}>
                                {filled > 0 ? formatPnl(pnl) : signalOnly ? "At signal" : "Not filled"}
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
                ) : tab === "trades" ? (
                  <VipTradesPanel
                    lines={visibleRun.lines.map((row) => row.line)}
                    trades={combined.trades}
                    tradeEquity={combined.trade_equity ?? {}}
                    timeZone={timeZone}
                    lineId={tradeLineId}
                    onLineId={setTradeLineId}
                  />
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
      <AccountDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        accounts={vipsQ.data ?? []}
        loading={vipsQ.isLoading}
        error={vipsQ.error}
        selectedId={vip?.id ?? null}
        creating={create.isPending}
        deleting={remove.isPending}
        onSelect={(id) => {
          setSelectedId(id)
          setAccountOpen(false)
        }}
        onCreate={(label) => create.mutate(label)}
        createError={create.error?.message}
        onRename={(id, next) => save.mutate({ id, name: next })}
        onDelete={(id, label) => {
          if (window.confirm(`Delete ${label}?`)) remove.mutate(id)
        }}
      />
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

function SymbolOverlay({
  lines,
  showBarClose,
  timeZone,
}: {
  lines: VipRun["lines"]
  showBarClose: boolean
  timeZone: string
}) {
  const series = useMemo(() => {
    return lines.flatMap((row, index) => {
      const result = showBarClose ? row.bar_close : row.signal
      const balance = result?.settings?.starting_balance ?? 0
      const points = (result?.equity ?? [])
        .map((point) => ({ t: Date.parse(point.t), pnl: point.equity - balance }))
        .filter((point) => !Number.isNaN(point.t))
        .sort((a, b) => a.t - b.t)
      if (points.length === 0) return []
      return [
        {
          key: row.line.id,
          label: `${row.line.symbol} ${row.line.strategy_id}`,
          color: LINE_COLORS[index % LINE_COLORS.length],
          points,
        },
      ]
    })
  }, [lines, showBarClose])

  const data = useMemo(() => {
    const times = [...new Set(series.flatMap((item) => item.points.map((point) => point.t)))].sort(
      (a, b) => a - b,
    )
    const cursor = series.map(() => 0)
    const last = series.map(() => 0)
    return times.map((t) => {
      const row: Record<string, number> = { t }
      series.forEach((item, index) => {
        while (cursor[index] < item.points.length && item.points[cursor[index]].t <= t) {
          last[index] = item.points[cursor[index]].pnl
          cursor[index] += 1
        }
        row[item.key] = last[index]
      })
      return row
    })
  }, [series])

  const config = useMemo(() => {
    const next: ChartConfig = {}
    for (const item of series) next[item.key] = { label: item.label, color: item.color }
    return next
  }, [series])

  if (series.length === 0) return null

  return (
    <div className="border-t border-border px-3 py-3">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        Symbols together
      </p>
      <p className="mt-0.5 mb-2 text-[11px] text-muted-foreground">
        One curve per symbol. The total above is all of them added.
      </p>
      <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickFormatter={(value) =>
              new Date(Number(value)).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone,
              })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value) => formatPnl(Number(value))}
          />
          <ChartTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const when = new Date(Number(label)).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone,
              })
              return (
                <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
                  <p className="mb-1 text-muted-foreground">{when}</p>
                  {payload.map((item) => (
                    <p key={String(item.dataKey)} className="font-mono tabular-nums" style={{ color: item.color }}>
                      {item.name} {formatPnl(Number(item.value))}
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Legend />
          {series.map((item) => (
            <Line
              key={item.key}
              type="stepAfter"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  )
}

function FillGroupCard({
  active,
  title,
  tfLabel,
  pnl,
  recommended = false,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  pnl: number | null | undefined
  recommended?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-full rounded-md border px-2 py-1.5 text-left transition-all",
        active
          ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">
          {title}
          <span className="ml-1 font-mono tabular-nums">· {tfLabel}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {recommended ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold tracking-wide text-white uppercase">
              Recommended
            </span>
          ) : null}
          {active ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold tracking-wide text-white uppercase">
              On
            </span>
          ) : null}
        </span>
      </div>
      <p className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", pnlClass(pnl))}>
        {formatPnl(pnl)}
      </p>
    </button>
  )
}

export function AccountDialog({
  open,
  onOpenChange,
  accounts,
  loading,
  error,
  selectedId,
  creating,
  deleting,
  createError,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: VipAccount[]
  loading: boolean
  error: Error | null
  selectedId: string | null
  creating: boolean
  deleting: boolean
  createError?: string
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const [newName, setNewName] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  useEffect(() => {
    if (!open) {
      setNewName("")
      setRenamingId(null)
    }
  }, [open])

  function commitRename(account: VipAccount) {
    const next = renameValue.trim()
    if (next && next !== account.name) onRename(account.id, next)
    setRenamingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pr-12 pb-2">
          <DialogTitle>VIP accounts</DialogTitle>
          <DialogDescription>Create an account, or open one you already saved.</DialogDescription>
        </DialogHeader>
        <div className="px-5 pt-3 pb-4">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            New account
          </p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newName.trim()) onCreate(newName.trim())
              }}
              placeholder="Account name"
              className="h-9"
            />
            <Button
              type="button"
              disabled={!newName.trim() || creating}
              onClick={() => onCreate(newName.trim())}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
          {createError ? <p className="mt-2 text-[11px] text-rose-500">{createError}</p> : null}
        </div>
        <div className="max-h-[min(24rem,50vh)] overflow-y-auto border-t px-3 py-2">
          {loading ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">Loading accounts…</p>
          ) : error ? (
            <p className="px-2 py-3 text-[12px] text-rose-500">{error.message}</p>
          ) : accounts.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {accounts.map((account) => {
                const selected = account.id === selectedId
                return (
                  <li key={account.id} className="flex items-center gap-1">
                    {renamingId === account.id ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => commitRename(account)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                          if (event.key === "Escape") setRenamingId(null)
                        }}
                        className="h-9 text-[13px]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(account.id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                          selected ? "bg-amber-500/10 text-foreground" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{account.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {account.lines.length} {account.lines.length === 1 ? "symbol" : "symbols"}
                          </span>
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      title="Rename"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setRenamingId(account.id)
                        setRenameValue(account.name)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete account"
                      disabled={deleting}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => onDelete(account.id, account.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const MATCH_LIMIT = 50

function StrategyMatches({
  matches,
  draft,
  onPick,
}: {
  matches: StrategyInfo[]
  draft: VipLine
  onPick: (symbol: string, strategyId: string) => void
}) {
  if (matches.length === 0) {
    return <p className="px-3 py-3 text-[12px] text-muted-foreground">No matches.</p>
  }
  const shown = matches.slice(0, MATCH_LIMIT)
  return (
    <>
      {shown.map((row) => {
        const selected = draft.symbol === row.symbol && draft.strategy_id === row.strategy_id
        return (
          <button
            key={`${row.symbol}-${row.strategy_id}`}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
              selected ? "bg-amber-500/10 font-medium" : "hover:bg-muted/50",
            )}
            onClick={() => onPick(row.symbol, row.strategy_id)}
          >
            <span className="font-mono font-semibold">{row.symbol}</span>
            <span className="text-muted-foreground">{row.strategy_id}</span>
          </button>
        )
      })}
      {matches.length > shown.length ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">
          {shown.length} of {matches.length.toLocaleString()}. Keep typing to narrow this list.
        </p>
      ) : null}
    </>
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
  const [draft, setDraft] = useState<VipLine>({ ...line, exit_mode: line.exit_mode ?? "atr" })
  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: api.strategies })
  const [query, setQuery] = useState("")
  const [replacing, setReplacing] = useState(false)
  const chosen = Boolean(draft.symbol && draft.strategy_id)

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle) return []
    return (strategiesQ.data ?? []).filter(
      (row) =>
        row.symbol.toLowerCase().includes(needle) || row.strategy_id.toLowerCase().includes(needle),
    )
  }, [needle, strategiesQ.data])

  function pick(symbol: string, strategyId: string) {
    setDraft((prev) => ({ ...prev, symbol, strategy_id: strategyId }))
    setQuery("")
    setReplacing(false)
  }

  function setNumber<K extends keyof VipLine>(key: K, value: number) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{line.symbol ? "Edit symbol" : "Add symbol"}</DialogTitle>
          <DialogDescription>
            Choose the strategy, the exit, and the size for this symbol.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-5">
          <div>
            <p className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Symbol and strategy
            </p>
            {chosen && !replacing ? (
              <button
                type="button"
                onClick={() => setReplacing(true)}
                className="flex h-9 w-full items-center rounded-md border bg-background px-3 text-left text-[12px] hover:bg-muted/40"
              >
                <span className="font-mono font-semibold">{draft.symbol}</span>
                <span className="text-muted-foreground"> · Strategy {draft.strategy_id}</span>
              </button>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus={replacing}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setReplacing(false)
                  }}
                  className="h-9 pl-8 text-[12px]"
                  placeholder="Search symbol or strategy"
                />
              </div>
            )}
            {needle ? (
              <div
                className="mt-1 max-h-48 overflow-y-auto rounded-md border"
                onMouseDown={(event) => event.preventDefault()}
              >
                {strategiesQ.isLoading ? (
                  <p className="px-3 py-3 text-[12px] text-muted-foreground">Loading strategies…</p>
                ) : (
                  <StrategyMatches matches={matches} draft={draft} onPick={pick} />
                )}
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <NumberField
              label="Bar close (min)"
              value={draft.chart_tf_minutes}
              step={1}
              min={0}
              onChange={(n) => setNumber("chart_tf_minutes", n)}
            />
            <p className="text-[11px] text-muted-foreground">
              Minutes after the signal. 0 keeps the fill at the signal.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Exit
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, exit_mode: "atr" }))}
                className={cn(
                  "rounded-md border px-2 py-2 text-left text-[12px]",
                  draft.exit_mode !== "csv"
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "hover:bg-muted/40",
                )}
              >
                <span className="block font-medium">ATR exits</span>
                <span className="text-[10px] text-muted-foreground">Take profit and stop</span>
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, exit_mode: "csv" }))}
                className={cn(
                  "rounded-md border px-2 py-2 text-left text-[12px]",
                  draft.exit_mode === "csv"
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "hover:bg-muted/40",
                )}
              >
                <span className="block font-medium">CSV exit</span>
                <span className="text-[10px] text-muted-foreground">TradingView close</span>
              </button>
            </div>
            {draft.exit_mode === "csv" ? (
              <p className="text-[11px] text-muted-foreground">
                This symbol closes where the CSV says. ATR is not used.
              </p>
            ) : (
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
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Position size
            </p>
            <div className="grid grid-cols-2 gap-3">
            <NumberField label="Lots" value={draft.lots} step={0.01} min={0.01} onChange={(n) => setNumber("lots", n)} />
            <NumberField label="Commission / lot" value={draft.commission_per_lot} step={0.5} min={0} onChange={(n) => setNumber("commission_per_lot", n)} />
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

function VipTradesPanel({
  lines,
  trades,
  tradeEquity,
  timeZone,
  lineId,
  onLineId,
}: {
  lines: VipLine[]
  trades: VipRun["signal"]["trades"]
  tradeEquity: NonNullable<VipRun["signal"]["trade_equity"]>
  timeZone: string
  lineId: string | null
  onLineId: (lineId: string | null) => void
}) {
  const selected = lines.find((line) => line.id === lineId) ?? null
  const shown = selected
    ? trades.filter((trade) => trade.symbol === selected.symbol && trade.strategy_id === selected.strategy_id)
    : trades
  const filled = shown.filter((trade) => trade.status === "ok" && trade.net_pnl_usd != null).length

  return (
    <div className="flex min-h-[24rem] flex-1 flex-col pb-10">
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
        <div>
          <p className="text-sm font-medium tracking-tight">Simulated trades</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {filled} filled · {shown.length - filled} skipped
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <SymbolFilterChip active={selected == null} onClick={() => onLineId(null)}>
            All
          </SymbolFilterChip>
          {lines.map((line) => (
            <SymbolFilterChip
              key={line.id}
              active={selected?.id === line.id}
              onClick={() => onLineId(line.id)}
            >
              {`${line.symbol} ${line.strategy_id}`}
            </SymbolFilterChip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SimTradesTable
          rows={shown}
          tradeEquity={tradeEquity}
          timeZone={timeZone}
          showSymbol
        />
      </div>
    </div>
  )
}

function SymbolFilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 font-mono text-[11px] font-medium",
        active
          ? "border-amber-500/50 bg-amber-500/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  )
}

export function VipSuggestions({
  vipId,
  lines,
  timeZone,
  fillGroup,
  fillLabel,
  targetsOn,
  accountTp,
  accountSl,
  onApply,
}: {
  vipId: string
  lines: VipLine[]
  timeZone: string
  fillGroup: "signal" | "barClose"
  fillLabel: string
  targetsOn: boolean
  accountTp: number
  accountSl: number
  onApply: (tp: number, sl: number) => void
}) {
  const savedBuild = getVipExplorerBuild(vipId)
  const [tpFrom, setTpFrom] = useState(savedBuild.draft.tpFrom)
  const [tpTo, setTpTo] = useState(savedBuild.draft.tpTo)
  const [slFrom, setSlFrom] = useState(savedBuild.draft.slFrom)
  const [slTo, setSlTo] = useState(savedBuild.draft.slTo)
  const [step, setStep] = useState(savedBuild.draft.step)
  const [range, setRange] = useState(savedBuild.built)
  const [pending, setPending] = useState<{ tp: number; sl: number } | null>(null)
  const rangeReady = tpFrom > 0 && tpTo >= tpFrom && slFrom > 0 && slTo >= slFrom && step > 0
  const setupKey = lines
    .map((line) =>
      [
        line.id,
        line.symbol,
        line.strategy_id,
        line.exit_mode,
        line.atr_bar_minutes,
        line.atr_period,
        line.tp_atr_mult,
        line.sl_atr_mult,
        line.lots,
        line.commission_per_lot,
        line.chart_tf_minutes,
      ].join(":"),
    )
    .join("|")
  const gridQ = useQuery({
    queryKey: ["vip-targets", vipId, timeZone, setupKey, range],
    queryFn: () =>
      api.vipTargetGrid(
        vipId,
        {
          tp_from: range!.tpFrom,
          tp_to: range!.tpTo,
          sl_from: range!.slFrom,
          sl_to: range!.slTo,
          step: range!.step,
        },
        timeZone,
      ),
    enabled: range !== null,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    saveVipExplorerBuild(vipId, {
      draft: { tpFrom, tpTo, slFrom, slTo, step },
      built: range,
    })
  }, [vipId, tpFrom, tpTo, slFrom, slTo, step, range])

  const data = gridQ.data
  const matrix = fillGroup === "barClose" && data?.bar_close ? data.bar_close : data?.signal
  const profits = (matrix ?? []).flat().map((cell) => cell.profit)
  const lo = profits.length ? Math.min(...profits) : 0
  const hi = profits.length ? Math.max(...profits) : 1
  const span = Math.max(hi - lo, 1)

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-tight">TP / SL Grid</p>
          <p className="mt-0.5 max-w-xl text-[11px] text-muted-foreground">
            {fillLabel}. Dollars for the whole account. Press Build, then choose a cell. The equity curve stays as it is until you run again.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24"><NumberField label="TP from" value={tpFrom} onChange={setTpFrom} step={step > 0 ? step : 1} min={1} /></div>
          <div className="w-24"><NumberField label="TP to" value={tpTo} onChange={setTpTo} step={step > 0 ? step : 1} min={1} /></div>
          <div className="w-24"><NumberField label="SL from" value={slFrom} onChange={setSlFrom} step={step > 0 ? step : 1} min={1} /></div>
          <div className="w-24"><NumberField label="SL to" value={slTo} onChange={setSlTo} step={step > 0 ? step : 1} min={1} /></div>
          <div className="w-24"><NumberField label="Step" value={step} onChange={setStep} step={50} min={1} /></div>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!rangeReady || gridQ.isFetching}
            onClick={() => setRange({ tpFrom, tpTo, slFrom, slTo, step })}
          >
            {range ? "Update" : "Build"}
          </Button>
        </div>
      </div>
      {range === null ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Press Build to fill the table. This works with the account checkbox off.
        </div>
      ) : gridQ.isLoading ? (
        <LoadingState title="Building the table" message="Replaying each dollar pair on the simulated trades." />
      ) : gridQ.isError ? (
        <p className="text-sm text-destructive">{gridQ.error.message}</p>
      ) : data && matrix ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted px-2 py-2 text-left font-medium">
                  <span className="text-emerald-700 dark:text-emerald-300">TP</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="text-rose-700 dark:text-rose-300">SL</span>
                </th>
                {data.sl.map((sl) => {
                  const activeSl = targetsOn && sl === accountSl
                  return (
                    <th
                      key={sl}
                      className={cn(
                        "px-2 py-2 text-center font-mono text-[12px] font-medium",
                        activeSl
                          ? "bg-rose-200 text-rose-950 dark:bg-rose-900 dark:text-rose-50"
                          : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
                      )}
                    >
                      {formatTarget(sl)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {data.tp.map((tp, rowIndex) => {
                const activeTp = targetsOn && tp === accountTp
                return (
                <tr key={tp} className="border-b border-border/60 last:border-0">
                  <th
                    className={cn(
                      "sticky left-0 z-10 px-2 py-1.5 text-left font-mono text-[12px] font-medium",
                      activeTp
                        ? "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50"
                        : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                    )}
                  >
                    {formatTarget(tp)}
                  </th>
                  {data.sl.map((sl, colIndex) => {
                    const cell = matrix[rowIndex]?.[colIndex]
                    if (!cell) return <td key={sl} />
                    const rank = (cell.profit - lo) / span
                    const selected = activeTp && sl === accountSl
                    const wash = cell.hit === "none"
                      ? `rgba(56, 189, 248, ${0.16 + rank * 0.34})`
                      : cell.profit >= 0
                        ? `rgba(16, 185, 129, ${0.05 + rank * 0.62})`
                        : `rgba(244, 63, 94, ${0.05 + (1 - rank) * 0.62})`
                    const outcome = cell.hit === "tp" ? "Take profit" : cell.hit === "sl" ? "Stop" : "Neither"
                    return (
                      <td key={sl} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => setPending({ tp, sl })}
                          className={cn(
                            "flex w-full flex-col items-center gap-1 rounded-sm px-1.5 py-1.5 text-center",
                            "hover:ring-1 hover:ring-inset hover:ring-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
                            selected && "ring-1 ring-inset ring-amber-300",
                          )}
                          style={{ backgroundColor: wash }}
                        >
                          <span className="font-mono text-[13px] font-medium tabular-nums leading-none text-foreground">
                            {formatPnl(cell.profit)}
                          </span>
                          <span
                            className={cn(
                              "text-[9px] font-medium tracking-wide uppercase",
                              cell.hit === "tp" && "text-emerald-300/80",
                              cell.hit === "sl" && "text-rose-300/80",
                              cell.hit === "none" && "text-sky-200",
                            )}
                          >
                            {outcome}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use this take profit and stop?</DialogTitle>
            <DialogDescription>
              These amounts are saved on the VIP account. VIP opens so you can run the equity curve.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pending) return
                onApply(pending.tp, pending.sl)
                setPending(null)
              }}
            >
              Open VIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function latticeMin(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return 0
  const scale = 1000
  const scaledStep = Math.round(step * scale)
  if (scaledStep === 0) return 0
  const scaledValue = Math.round(value * scale)
  return (((scaledValue % scaledStep) + scaledStep) % scaledStep) / scale
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
  onBlur,
}: {
  label: string
  value: number
  step: number
  min: number
  onChange: (n: number) => void
  onBlur?: () => void
}) {
  return (
    <label
      className="flex flex-col gap-1"
      onKeyDownCapture={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        event.preventDefault()
        event.stopPropagation()
        const delta = event.key === "ArrowUp" ? step : -step
        const places = (String(step).split(".")[1] ?? "").length
        const scale = 10 ** places
        const next = Math.round((value + delta) * scale) / scale
        onChange(Math.max(min, next))
      }}
    >
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <Input
        type="number"
        step={step}
        min={latticeMin(value, step)}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onBlur}
        className="h-8 font-mono text-[12px]"
      />
    </label>
  )
}
