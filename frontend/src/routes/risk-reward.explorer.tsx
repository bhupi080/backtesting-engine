import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Play, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, type StrategyInfo } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import {
  getRiskExplorerAtrBar,
  getRiskExplorerAtrPeriod,
  getRiskExplorerChartTf,
  getRiskExplorerCommission,
  getRiskExplorerFillGroup,
  getRiskExplorerLots,
  getRiskExplorerPick,
  getRiskRewardSession,
  getSuggestionBuilt,
  getSuggestionDraft,
  getSuggestionRange,
  saveRiskExplorerAtrBar,
  saveRiskExplorerAtrPeriod,
  saveRiskExplorerChartTf,
  saveRiskExplorerCommission,
  saveRiskExplorerFillGroup,
  saveRiskExplorerLots,
  saveRiskExplorerPick,
  saveRiskRewardSession,
  saveSuggestionBuilt,
  saveSuggestionDraft,
  saveSuggestionRange,
} from "@/lib/run-session"
import { cn } from "@/lib/utils"
import { ATR_BARS, SuggestionGrid } from "@/routes/risk-reward"

export const Route = createFileRoute("/risk-reward/explorer")({
  component: RiskRewardExplorerPage,
})

function RiskRewardExplorerPage() {
  const saved = getRiskRewardSession()
  const picked = getRiskExplorerPick()
  const draft = getSuggestionDraft()
  const { selectAndApply } = useFilters()
  const navigate = useNavigate()
  const [symbol, setSymbol] = useState(picked.symbol)
  const [strategyId, setStrategyId] = useState(picked.strategyId)
  const [fillGroup, setFillGroup] = useState(getRiskExplorerFillGroup)
  const [chartTf, setChartTf] = useState(getRiskExplorerChartTf)
  const [lots, setLots] = useState(getRiskExplorerLots)
  const [commission, setCommission] = useState(getRiskExplorerCommission)
  const [atrBar, setAtrBar] = useState(getRiskExplorerAtrBar)
  const [atrPeriod, setAtrPeriod] = useState(getRiskExplorerAtrPeriod)
  const [tpFrom, setTpFrom] = useState(draft.tpFrom)
  const [tpTo, setTpTo] = useState(draft.tpTo)
  const [slFrom, setSlFrom] = useState(draft.slFrom)
  const [slTo, setSlTo] = useState(draft.slTo)
  const [range, setRange] = useState(getSuggestionBuilt() ? getSuggestionRange() : null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const ready = Boolean(symbol && strategyId)
  const atrBarLabel = ATR_BARS.find((bar) => Number(bar.value) === atrBar)?.label ?? `${atrBar} min`
  const chooseFill = (next: "signal" | "barClose") => {
    setFillGroup(next)
    saveRiskExplorerFillGroup(next)
  }
  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: api.strategies })
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (strategiesQ.data ?? []).filter(
      (row) =>
        !q ||
        row.symbol.toLowerCase().includes(q) ||
        row.strategy_id.toLowerCase().includes(q),
    )
    const map = new Map<string, StrategyInfo[]>()
    for (const row of rows) {
      const list = map.get(row.symbol)
      if (list) list.push(row)
      else map.set(row.symbol, [row])
    }
    return [...map.entries()]
      .map(([name, strategies]) => ({
        symbol: name,
        strategies: strategies.sort((a, b) => a.strategy_id.localeCompare(b.strategy_id)),
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [query, strategiesQ.data])

  useEffect(() => {
    saveSuggestionDraft({ tpFrom, tpTo, slFrom, slTo })
  }, [tpFrom, tpTo, slFrom, slTo])

  useEffect(() => {
    if (range) saveSuggestionRange(range)
    saveSuggestionBuilt(range !== null)
  }, [range])

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background/60 lg:flex-row">
        <aside
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden border-border bg-muted/20",
            "transition-[width,max-height] duration-200 ease-linear",
            "max-lg:border-b lg:border-r",
            sidebarOpen
              ? "max-h-[42%] w-full lg:max-h-none lg:w-64"
              : "max-h-0 w-full border-transparent lg:max-h-none lg:w-0",
          )}
        >
          <div className="flex h-full w-full min-w-0 flex-1 flex-col lg:min-w-64">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Setup</p>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="size-3.5" />
              <span className="sr-only">Hide sidebar</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                Strategy
              </p>
              <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                <DialogTrigger
                  render={
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-left hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-semibold">{symbol || "Symbol"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {strategyId || "Pick a strategy"}
                        </p>
                      </div>
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  }
                />
                <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Strategy</DialogTitle>
                  </DialogHeader>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search symbol or strategy"
                      className="h-9 pl-8 text-[12px]"
                    />
                  </div>
                  <div className="max-h-[50vh] overflow-y-auto pr-1">
                    {strategiesQ.isLoading ? (
                      <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading strategies…</p>
                    ) : groups.length === 0 ? (
                      <p className="px-1 py-6 text-center text-sm text-muted-foreground">No strategies match.</p>
                    ) : (
                      <ul className="space-y-1">
                        {groups.map((group) => {
                          const open = query.trim() ? true : (expanded[group.symbol] ?? group.symbol === symbol)
                          return (
                            <li key={group.symbol}>
                              <button
                                type="button"
                                onClick={() => setExpanded((prev) => ({ ...prev, [group.symbol]: !open }))}
                                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                              >
                                <ChevronDown
                                  className={cn(
                                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                    !open && "-rotate-90",
                                  )}
                                />
                                <span className="font-mono text-[12px] font-semibold">{group.symbol}</span>
                              </button>
                              {open ? (
                                <ul className="mt-0.5 mb-1 ml-2 space-y-0.5 border-l border-border/60 pl-2">
                                  {group.strategies.map((row) => {
                                    const active = row.symbol === symbol && row.strategy_id === strategyId
                                    return (
                                      <li key={`${row.symbol}-${row.strategy_id}`}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSymbol(row.symbol)
                                            setStrategyId(row.strategy_id)
                                            saveRiskExplorerPick(row.symbol, row.strategy_id)
                                            setPickerOpen(false)
                                          }}
                                          className={cn(
                                            "flex w-full rounded-md px-2 py-1.5 text-left text-[12px]",
                                            active ? "bg-orange-500/10 ring-1 ring-orange-500/25" : "hover:bg-muted/50",
                                          )}
                                        >
                                          {row.strategy_id}
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
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">ATR levels</p>
              <div className="space-y-1">
                <label className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Bar size
                </label>
                <Select
                  value={String(atrBar)}
                  onValueChange={(value) => {
                    if (!value) return
                    const next = Number(value)
                    setAtrBar(next)
                    saveRiskExplorerAtrBar(next)
                  }}
                >
                  <SelectTrigger size="sm" className="h-9 w-full text-[12px]">
                    <SelectValue>{atrBarLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ATR_BARS.map((bar) => (
                      <SelectItem key={bar.value} value={bar.value}>
                        {bar.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field
                label="Length"
                value={atrPeriod}
                min={2}
                step={1}
                onChange={(next) => {
                  setAtrPeriod(next)
                  saveRiskExplorerAtrPeriod(next)
                }}
              />
            </div>

            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Account</p>
              <Field
                label="Lots"
                value={lots}
                min={0.01}
                step={0.01}
                onChange={(next) => {
                  setLots(next)
                  saveRiskExplorerLots(next)
                }}
              />
              <Field
                label="Commission / lot"
                value={commission}
                min={0}
                step={0.1}
                onChange={(next) => {
                  setCommission(next)
                  saveRiskExplorerCommission(next)
                }}
              />
              <Field
                label="Chart TF (min)"
                value={chartTf}
                min={0}
                step={1}
                onChange={(next) => {
                  const minutes = Math.max(0, Math.round(next))
                  setChartTf(minutes)
                  saveRiskExplorerChartTf(minutes)
                  if (minutes <= 0) chooseFill("signal")
                }}
              />
            </div>

            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Grid</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="TP from" value={tpFrom} min={0.1} step={0.1} onChange={setTpFrom} />
                <Field label="TP to" value={tpTo} min={0.1} step={0.1} onChange={setTpTo} />
                <Field label="SL from" value={slFrom} min={0.1} step={0.1} onChange={setSlFrom} />
                <Field label="SL to" value={slTo} min={0.1} step={0.1} onChange={setSlTo} />
              </div>
            </div>

            <Button
              className="mt-1 gap-1.5 bg-orange-600 text-white hover:bg-orange-600/90"
              disabled={!ready}
              onClick={() => setRange({ tpFrom, tpTo, slFrom, slTo })}
            >
              <Play className="size-3.5" />
              {range ? "Update" : "Build"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {ready ? `${symbol} / ${strategyId}` : "Pick a symbol and strategy, then click Build"}
            </p>
          </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 overflow-hidden border-b border-border px-3 transition-[max-height,opacity,padding] duration-200 ease-linear",
              sidebarOpen ? "max-h-0 opacity-0 py-0" : "max-h-10 opacity-100 py-1.5",
            )}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelLeftOpen className="size-3.5" />
              Setup
            </button>
            {ready ? (
              <span className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{symbol}</span>
                <span className="mx-1">/</span>
                {strategyId}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs font-semibold">{symbol || "Symbol"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{strategyId || "Pick a strategy"}</p>
            </div>
            <div className="grid w-full shrink-0 grid-cols-2 gap-1.5 sm:ml-auto sm:w-[28rem]">
              <FillCard
                active={fillGroup === "signal"}
                title="At signal"
                tfLabel="0m"
                recommended
                onClick={() => chooseFill("signal")}
              />
              <FillCard
                active={fillGroup === "barClose"}
                title="Bar close"
                tfLabel={`${chartTf}m`}
                disabled={chartTf <= 0}
                onClick={() => chooseFill("barClose")}
              />
            </div>
          </div>
          {ready ? (
            <SuggestionGrid
              symbol={symbol}
              strategyId={strategyId}
              lots={lots}
              commission={commission}
              chartTf={chartTf}
              atrBar={atrBar}
              atrPeriod={atrPeriod}
              fillGroup={fillGroup}
              tpMult={saved.tpMult}
              slMult={saved.slMult}
              range={range}
              onPick={(tp, sl) => {
                selectAndApply({ symbol, strategyId })
                saveRiskRewardSession({
                  tpMult: tp,
                  slMult: sl,
                  chartTf,
                  lots,
                  commission,
                  atrBar,
                  atrPeriod,
                  activeTab: "overview",
                })
                void navigate({ to: "/risk-reward" })
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Pick a symbol and strategy, then click Build.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  step,
  min,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
  min: number
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
        className="h-9 w-full font-mono text-[12px]"
      />
    </label>
  )
}

function FillCard({
  active,
  title,
  tfLabel,
  recommended = false,
  disabled = false,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  recommended?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-1.5 text-left transition-all",
        active
          ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[10px] font-medium text-muted-foreground">
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
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">ATR</p>
          <p className="font-mono text-[13px] font-semibold text-muted-foreground tabular-nums">—</p>
        </div>
        <div>
          <p className="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">No ATR</p>
          <p className="font-mono text-[13px] font-semibold text-muted-foreground tabular-nums">—</p>
        </div>
      </div>
    </button>
  )
}
