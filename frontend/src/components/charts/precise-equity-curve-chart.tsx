import { useMemo } from "react"

import {
  SignedAreaCurveChart,
  equityToCurvePoints,
  type SignedAreaCurveChartProps,
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
  /** mt5-dashboard style Max Runup / Max DD cards beside the chart */
  showExtremumStats?: boolean
  /** Optional overrides (e.g. backend MAE/MFE); otherwise derived from curve */
  extremum?: ExtremumStats
  timeZone?: string
} & Pick<SignedAreaCurveChartProps, "emptyMessage" | "curveType">

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
})

function formatClock(iso: string | null | undefined, timeZone: string): string | null {
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

/** Equity-curve convenience wrapper around SignedAreaCurveChart. */
export function PreciseEquityCurveChart({
  equity,
  className,
  emptyMessage = "No equity points",
  curveType = "linear",
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
  }, [stats.maxRunup, stats.maxDrawdown, stats.maxRunupTime, stats.maxDrawdownTime])

  const chart = (
    <SignedAreaCurveChart
      data={equityToCurvePoints(equity)}
      valueLabel="P&L"
      className={cn(showExtremumStats ? "h-full min-h-[10rem] w-full aspect-auto" : null, className)}
      emptyMessage={emptyMessage}
      anchorAtZero
      showExtremumDots
      extremumDots={extremumDots}
      curveType={curveType}
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
      <div className="min-w-0 flex-1 p-1.5">{chart}</div>
      <div className="flex w-44 shrink-0 flex-col gap-2 border-l bg-muted/30 p-2.5">
        <div className="flex gap-2">
          <div className="flex-1 rounded-md border bg-background/50 p-2">
            <span className="mb-1 block text-[9px] font-semibold uppercase text-muted-foreground">
              Max Runup
            </span>
            <div className="space-y-1">
              <span className="text-xs font-bold text-green-600 dark:text-green-500">
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
              <span className="text-xs font-bold text-red-600 dark:text-red-500">
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
