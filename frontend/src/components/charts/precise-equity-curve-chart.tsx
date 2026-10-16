import { useMemo, useState } from "react"
import { ZoomIn, X } from "lucide-react"

import {
  SignedAreaCurveChart,
  equityToCurvePoints,
  type SessionBand,
} from "@/components/charts/signed-area-curve-chart"
import { SessionLegend } from "@/components/charts/session-legend"
import { cn } from "@/lib/utils"

export type EquityPoint = {
  t: string
  equity: number
  drawdown?: number
}

export type ExtremumStats = {
  /**
   * MFE — Maximum Favorable Excursion from baseline (account start or trade entry).
   * Greatest temporary gain on the curve.
   */
  maxRunup?: number | null
  /**
   * MAE — Maximum Adverse Excursion from baseline.
   * Greatest temporary loss on the curve (usually ≤ 0).
   */
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
  sessionBands?: SessionBand[]
  timeZone?: string
  /** Allow opening the curve in a centered popup */
  allowZoom?: boolean
  /** Optional fixed X-axis domain in ms. */
  domain?: [number, number]
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

/**
 * Account/trade path excursions from baseline (start or entry = 0):
 * MFE = max floating gain, MAE = max floating loss.
 */
function deriveExtremum(equity: EquityPoint[]): Required<ExtremumStats> {
  let mfe = -Infinity
  let mae = Infinity
  let maxRunupTime: string | null = null
  let maxDrawdownTime: string | null = null

  for (const p of equity) {
    if (p.equity > mfe) {
      mfe = p.equity
      maxRunupTime = p.t
    }
    if (p.equity < mae) {
      mae = p.equity
      maxDrawdownTime = p.t
    }
  }

  return {
    maxRunup: mfe === -Infinity ? 0 : mfe,
    maxDrawdown: mae === Infinity ? 0 : mae,
    maxRunupTime,
    maxDrawdownTime,
  }
}

function useExtremumDots(
  equity: EquityPoint[],
  extremum: ExtremumStats | undefined,
) {
  const derived = useMemo(() => deriveExtremum(equity), [equity])
  const stats: Required<ExtremumStats> = {
    maxRunup: extremum?.maxRunup ?? derived.maxRunup,
    maxDrawdown: extremum?.maxDrawdown ?? derived.maxDrawdown,
    maxRunupTime: extremum?.maxRunupTime ?? derived.maxRunupTime,
    maxDrawdownTime: extremum?.maxDrawdownTime ?? derived.maxDrawdownTime,
  }

  const dots = useMemo(() => {
    const runupMs = stats.maxRunupTime ? Date.parse(stats.maxRunupTime) : NaN
    const maeMs = stats.maxDrawdownTime
      ? Date.parse(stats.maxDrawdownTime)
      : NaN
    return {
      maxRunup:
        stats.maxRunup != null && !Number.isNaN(runupMs)
          ? { time: runupMs, pnl: Number(stats.maxRunup) }
          : null,
      maxDrawdown:
        stats.maxDrawdown != null && !Number.isNaN(maeMs)
          ? { time: maeMs, pnl: Number(stats.maxDrawdown) }
          : null,
    }
  }, [
    stats.maxRunup,
    stats.maxDrawdown,
    stats.maxRunupTime,
    stats.maxDrawdownTime,
  ])

  return { stats, dots }
}

function RightRail({
  netProfit,
  stats,
  timeZone,
}: {
  netProfit: number
  stats: Required<ExtremumStats>
  timeZone: string
}) {
  const mfeClock = formatClock(stats.maxRunupTime, timeZone)
  const maeClock = formatClock(stats.maxDrawdownTime, timeZone)

  return (
    <div className="flex w-44 shrink-0 flex-col gap-2 bg-muted/30 p-3">
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          Total PnL
        </span>
        <span
          className={`text-sm font-bold tabular-nums ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
        >
          {usdFmt.format(netProfit)}
        </span>
      </div>

      <div className="rounded-md border bg-background/50 p-2">
        <span className="mb-0.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase text-muted-foreground">
          <span className="size-1.5 rounded-full bg-green-500" />
          MFE
        </span>
        <span className="block text-xs font-bold tabular-nums text-green-600">
          {usdFmt.format(Number(stats.maxRunup ?? 0))}
        </span>
        <span className="text-[9px] text-muted-foreground">
          {mfeClock ? `max favorable · ${mfeClock}` : "max favorable excursion"}
        </span>
      </div>

      <div className="rounded-md border bg-background/50 p-2">
        <span className="mb-0.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase text-muted-foreground">
          <span className="size-1.5 rounded-full bg-red-500" />
          MAE
        </span>
        <span className="block text-xs font-bold tabular-nums text-red-600">
          {usdFmt.format(Number(stats.maxDrawdown ?? 0))}
        </span>
        <span className="text-[9px] leading-snug text-muted-foreground">
          {maeClock
            ? `max adverse · ${maeClock}`
            : "max adverse excursion"}
        </span>
      </div>
    </div>
  )
}

function ZoomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2 top-2 z-20 rounded-md border bg-background/90 p-1.5 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      aria-label="Zoom chart"
    >
      <ZoomIn className="h-4 w-4" />
    </button>
  )
}

export type EquityCurveZoomModalProps = {
  open: boolean
  onClose: () => void
  equity: EquityPoint[]
  emptyMessage?: string
  extremum?: ExtremumStats
  sessionBands?: SessionBand[]
  timeZone?: string
  domain?: [number, number]
  /** Optional override for the title line */
  title?: string
  /** Optional extra subtitle after the points / ending line */
  subtitle?: string
}

/**
 * Reusable centered equity-curve popup (header + chart + Total/Runup/DD cards).
 * Used by chart zoom buttons and the Trades table row action.
 */
export function EquityCurveZoomModal({
  open,
  onClose,
  equity,
  emptyMessage = "No equity points",
  extremum,
  sessionBands,
  timeZone = "Europe/Bucharest",
  domain,
  title = "Equity curve",
  subtitle,
}: EquityCurveZoomModalProps) {
  const { stats, dots } = useExtremumDots(equity, extremum)
  const netProfit = equity.length > 0 ? equity[equity.length - 1].equity : 0

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.currentTarget === e.target) onClose()
      }}
    >
      <div className="flex w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-lg border bg-popover p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">
              {equity.length} points · ending{" "}
              <span
                className={
                  netProfit >= 0 ? "text-green-600" : "text-red-600"
                }
              >
                {usdFmt.format(netProfit)}
              </span>
              {subtitle ? (
                <span className="text-muted-foreground"> · {subtitle}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border bg-background p-2 text-muted-foreground hover:text-foreground"
            aria-label="Close zoom"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <SessionLegend
          timeZone={timeZone}
          className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground"
        />

        <div className="h-[22rem] overflow-hidden rounded-lg border bg-card">
          <SignedAreaCurveChart
            data={equityToCurvePoints(equity)}
            valueLabel="P&L"
            className="h-full w-full"
            emptyMessage={emptyMessage}
            anchorAtZero
            showExtremumDots
            extremumDots={dots}
            curveType="monotone"
            sessionBands={sessionBands}
            timeZone={timeZone}
            domain={domain}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border bg-card p-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">
              Total PnL
            </span>
            <div
              className={`text-sm font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {usdFmt.format(netProfit)}
            </div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">
              MFE
            </span>
            <div className="text-sm font-bold text-green-600">
              {usdFmt.format(Number(stats.maxRunup ?? 0))}
            </div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">
              MAE
            </span>
            <div className="text-sm font-bold text-red-600">
              {usdFmt.format(Number(stats.maxDrawdown ?? 0))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
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
  sessionBands,
  timeZone = "Europe/Bucharest",
  allowZoom = true,
  domain,
}: Props) {
  const [zoomed, setZoomed] = useState(false)
  const { stats, dots } = useExtremumDots(equity, extremum)
  const netProfit = equity.length > 0 ? equity[equity.length - 1].equity : 0

  const chartProps = {
    data: equityToCurvePoints(equity),
    valueLabel: "P&L" as const,
    emptyMessage,
    anchorAtZero: true as const,
    showExtremumDots: true as const,
    extremumDots: dots,
    curveType: "monotone" as const,
    sessionBands,
    timeZone,
    domain,
  }

  if (equity.length === 0) {
    return (
      <SignedAreaCurveChart
        {...chartProps}
        className={cn("aspect-auto w-full", className ?? "h-48")}
      />
    )
  }

  const zoomEnabled = allowZoom && equity.length > 0

  const inner = showExtremumStats ? (
    <div className="flex flex-row items-stretch overflow-hidden rounded-lg border bg-card">
      <div className="group relative min-w-0 flex-1">
        {zoomEnabled ? <ZoomButton onClick={() => setZoomed(true)} /> : null}
        <SignedAreaCurveChart
          {...chartProps}
          className={cn("aspect-auto h-48 w-full", className)}
        />
      </div>
      <RightRail netProfit={netProfit} stats={stats} timeZone={timeZone} />
    </div>
  ) : (
    <div
      className={cn(
        "group relative h-full min-h-[7rem] w-full overflow-hidden",
        className,
      )}
    >
      {zoomEnabled ? <ZoomButton onClick={() => setZoomed(true)} /> : null}
      <SignedAreaCurveChart
        {...chartProps}
        className="aspect-auto h-full min-h-[7rem] w-full"
      />
    </div>
  )

  return (
    <>
      {inner}
      <EquityCurveZoomModal
        open={zoomed}
        onClose={() => setZoomed(false)}
        equity={equity}
        emptyMessage={emptyMessage}
        extremum={extremum}
        sessionBands={sessionBands}
        timeZone={timeZone}
        domain={domain}
      />
    </>
  )
}
