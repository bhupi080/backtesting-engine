import { useMemo } from "react"

import {
  SignedAreaCurveChart,
  equityToCurvePoints,
} from "@/components/charts/signed-area-curve-chart"
import { cn } from "@/lib/utils"

export type EquityPoint = {
  t: string
  equity: number
  drawdown?: number
}

export type ExtremumStats = {
  maxRunup?: number | null
  maxDrawdown?: number | null
  maxRunupTime?: string | null
  maxDrawdownTime?: string | null
}

type Props = {
  equity: EquityPoint[]
  className?: string
  emptyMessage?: string
  /** mt5 Precise Equity Curve right-rail (Total PnL + Max Runup / Max DD) */
  showExtremumStats?: boolean
  extremum?: ExtremumStats
  timeZone?: string
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
})

function formatClock(
  iso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
}

function deriveExtremum(equity: EquityPoint[]): Required<ExtremumStats> {
  let maxRunup = -Infinity
  let maxDrawdown = Infinity
  let maxRunupTime: string | null = null
  let maxDrawdownTime: string | null = null
  for (const p of equity) {
    if (p.equity > maxRunup) {
      maxRunup = p.equity
      maxRunupTime = p.t
    }
    if (p.equity < maxDrawdown) {
      maxDrawdown = p.equity
      maxDrawdownTime = p.t
    }
  }
  return {
    maxRunup: maxRunup === -Infinity ? 0 : maxRunup,
    maxDrawdown: maxDrawdown === Infinity ? 0 : maxDrawdown,
    maxRunupTime,
    maxDrawdownTime,
  }
}

/**
 * Same shell as mt5-dashboard Precise Equity Curve row:
 * chart | right rail (Total PnL + Max Runup / Max DD).
 */
export function PreciseEquityCurveChart({
  equity,
  className,
  emptyMessage = "No equity points",
  showExtremumStats = false,
  extremum,
  timeZone = "Europe/Bucharest",
}: Props) {
  const derived = useMemo(() => deriveExtremum(equity), [equity])
  const stats = {
    maxRunup: extremum?.maxRunup ?? derived.maxRunup,
    maxDrawdown: extremum?.maxDrawdown ?? derived.maxDrawdown,
    maxRunupTime: extremum?.maxRunupTime ?? derived.maxRunupTime,
    maxDrawdownTime: extremum?.maxDrawdownTime ?? derived.maxDrawdownTime,
  }

  const netProfit = equity.length > 0 ? equity[equity.length - 1].equity : 0

  const extremumDots = useMemo(() => {
    const runupMs = stats.maxRunupTime ? Date.parse(stats.maxRunupTime) : NaN
    const ddMs = stats.maxDrawdownTime ? Date.parse(stats.maxDrawdownTime) : NaN
    return {
      maxRunup:
        stats.maxRunup != null && !Number.isNaN(runupMs)
          ? { time: runupMs, pnl: Number(stats.maxRunup) }
          : null,
      maxDrawdown:
        stats.maxDrawdown != null && !Number.isNaN(ddMs)
          ? { time: ddMs, pnl: Number(stats.maxDrawdown) }
          : null,
    }
  }, [
    stats.maxRunup,
    stats.maxDrawdown,
    stats.maxRunupTime,
    stats.maxDrawdownTime,
  ])

  const chart = (
    <SignedAreaCurveChart
      data={equityToCurvePoints(equity)}
      valueLabel="P&L"
      className={cn("aspect-auto h-48 w-full", className)}
      emptyMessage={emptyMessage}
      anchorAtZero
      showExtremumDots
      extremumDots={extremumDots}
      curveType="monotone"
      timeZone={timeZone}
    />
  )

  if (!showExtremumStats || equity.length === 0) {
    return chart
  }

  const runupClock = formatClock(stats.maxRunupTime, timeZone)
  const ddClock = formatClock(stats.maxDrawdownTime, timeZone)

  return (
    <div className="flex flex-row items-stretch overflow-hidden rounded-lg border bg-card">
      {/* Chart — same flex-1 center pane as mt5 EquityCurveRow */}
      <div className="min-w-0 flex-1">{chart}</div>

      {/* Right stats — match mt5 w-48 / muted/30 / Max Runup · Max DD */}
      <div className="flex w-48 shrink-0 flex-col gap-3 bg-muted/30 p-3">
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
            Total PnL
          </span>
          <span
            className={`text-sm font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {usdFmt.format(netProfit)}
          </span>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 rounded-md border bg-background/50 p-2">
            <span className="mb-1 block text-[9px] font-semibold uppercase text-muted-foreground">
              Max Runup
            </span>
            <div className="space-y-1">
              <span className="text-xs font-bold text-green-600">
                {usdFmt.format(Number(stats.maxRunup ?? 0))}
              </span>
              {runupClock ? (
                <div className="text-[9px] text-muted-foreground">{runupClock}</div>
              ) : null}
            </div>
          </div>
          <div className="flex-1 rounded-md border bg-background/50 p-2">
            <span className="mb-1 block text-[9px] font-semibold uppercase text-muted-foreground">
              Max DD
            </span>
            <div className="space-y-1">
              <span className="text-xs font-bold text-red-600">
                {usdFmt.format(Number(stats.maxDrawdown ?? 0))}
              </span>
              {ddClock ? (
                <div className="text-[9px] text-muted-foreground">{ddClock}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
