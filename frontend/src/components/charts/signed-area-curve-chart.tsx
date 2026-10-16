import { useId, useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

/** Canonical point: time string + numeric series value. */
export type CurvePoint = {
  t: string
  value: number
  /** Optional extra fields shown in tooltip */
  meta?: Record<string, number | string | null | undefined>
}

export type ExtremumDot = {
  time: number
  pnl: number
}

export type SignedAreaCurveChartProps = {
  data: CurvePoint[]
  valueLabel?: string
  className?: string
  emptyMessage?: string
  anchorAtZero?: boolean
  /** @deprecated Level slabs removed */
  showLevelGuides?: boolean
  showExtremumDots?: boolean
  extremumDots?: {
    maxRunup?: ExtremumDot | null
    maxDrawdown?: ExtremumDot | null
  }
  /** mt5 Precise Equity uses monotone */
  curveType?: "linear" | "monotone" | "stepAfter"
  timeZone?: string
  formatValue?: (n: number) => string
}

const COLORS = {
  green: "#22c55e",
  red: "#ef4444",
  grid: "#bfbfbfff",
  tick: "#666",
  cursor: "#bfbfbf",
} as const

const defaultFormatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

/**
 * Precise-Equity-Curve visual (mt5-dashboard parity):
 * green above 0 / red below, vertical grid, monotone areas, #22c55e / #ef4444.
 */
export function SignedAreaCurveChart({
  data,
  valueLabel = "Value",
  className,
  emptyMessage = "No data",
  anchorAtZero = true,
  showExtremumDots = true,
  extremumDots,
  curveType = "monotone",
  timeZone = "Europe/Bucharest",
  formatValue = defaultFormatUsd,
}: SignedAreaCurveChartProps) {
  const positiveGradientId = `pos-${useId().replace(/:/g, "")}`
  const negativeGradientId = `neg-${useId().replace(/:/g, "")}`

  const displayData = useMemo(() => {
    const points = data
      .map((p) => {
        const time = Date.parse(p.t)
        if (Number.isNaN(time)) return null
        return {
          time,
          pnl: p.value,
          positive_pnl: Math.max(0, p.value),
          negative_pnl: Math.min(0, p.value),
          meta: p.meta,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p != null)

    if (points.length === 0) return []
    if (!anchorAtZero) return points

    const first = points[0]
    return [
      {
        time: first.time - 1,
        pnl: 0,
        positive_pnl: 0,
        negative_pnl: 0,
        meta: undefined as CurvePoint["meta"],
      },
      ...points,
    ]
  }, [data, anchorAtZero])

  const netProfit =
    displayData.length > 0 ? displayData[displayData.length - 1].pnl : 0

  const xDomain = useMemo((): [number, number] => {
    if (displayData.length === 0) return [0, 1]
    return [
      Math.min(...displayData.map((d) => d.time)),
      Math.max(...displayData.map((d) => d.time)),
    ]
  }, [displayData])

  const ticks = useMemo(() => {
    if (displayData.length === 0) return []
    const [min, max] = xDomain
    const span = max - min || 1
    const step = span / 4
    return [min, min + step, min + 2 * step, min + 3 * step, max]
  }, [displayData, xDomain])

  const markers = useMemo(() => {
    if (!showExtremumDots || displayData.length === 0) {
      return {
        runup: null as ExtremumDot | null,
        drawdown: null as ExtremumDot | null,
      }
    }

    let runup: ExtremumDot | null = extremumDots?.maxRunup ?? null
    let drawdown: ExtremumDot | null = extremumDots?.maxDrawdown ?? null

    if (runup == null || drawdown == null) {
      let best = displayData[0]
      let worst = displayData[0]
      for (const p of displayData) {
        if (p.pnl > best.pnl) best = p
        if (p.pnl < worst.pnl) worst = p
      }
      if (runup == null) runup = { time: best.time, pnl: best.pnl }
      if (drawdown == null) drawdown = { time: worst.time, pnl: worst.pnl }
    }

    return { runup, drawdown }
  }, [displayData, showExtremumDots, extremumDots])

  if (displayData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <ChartContainer
      config={{
        pnl: { label: valueLabel, color: COLORS.green },
      }}
      className={cn("aspect-auto h-48 w-full justify-center", className)}
    >
      <AreaChart data={displayData}>
        <defs>
          <linearGradient id={positiveGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.4} />
            <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={negativeGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.4} />
            <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={true}
          strokeDasharray="3 3"
          horizontal={false}
          strokeOpacity={1}
          stroke={COLORS.grid}
        />
        <XAxis
          dataKey="time"
          domain={xDomain}
          type="number"
          tickFormatter={(value) =>
            new Date(value).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone,
            })
          }
          tick={{ fontSize: 10, fill: COLORS.tick }}
          axisLine={false}
          tickLine={false}
          minTickGap={30}
          ticks={ticks}
          interval={0}
        />
        <YAxis
          domain={["auto", "auto"]}
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={40}
          tick={{ fontSize: 10, fill: COLORS.tick }}
          tickFormatter={(value) =>
            new Intl.NumberFormat("en-US", {
              notation: "compact",
              compactDisplay: "short",
            }).format(value)
          }
        />
        <ChartTooltip
          cursor={{ stroke: COLORS.cursor, strokeDasharray: "3 3" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const point = payload.find(
              (p) =>
                p?.payload &&
                typeof (p.payload as { pnl?: unknown }).pnl === "number",
            )?.payload as
              | {
                  time?: number
                  pnl?: number
                  meta?: CurvePoint["meta"]
                }
              | undefined
            if (!point || point.time == null || point.pnl == null) return null
            const pnl = point.pnl
            return (
              <div className="rounded-lg border bg-background p-3 shadow-lg">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {new Date(point.time).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone,
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${pnl >= 0 ? "bg-green-500" : "bg-red-500"}`}
                    />
                    <span className="text-sm font-bold">
                      {valueLabel}: {formatValue(pnl)}
                    </span>
                  </div>
                  {point.meta &&
                    Object.entries(point.meta).map(([k, v]) =>
                      v == null || v === "" ? null : (
                        <div
                          key={k}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span>{k}:</span>
                          <span className="font-medium">
                            {typeof v === "number" ? v.toFixed(2) : String(v)}
                          </span>
                        </div>
                      ),
                    )}
                </div>
              </div>
            )
          }}
        />
        <ReferenceLine
          y={0}
          stroke={netProfit >= 0 ? COLORS.green : COLORS.red}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
        <Area
          type={curveType}
          dataKey="positive_pnl"
          stroke={COLORS.green}
          strokeWidth={2}
          fill={`url(#${positiveGradientId})`}
          fillOpacity={0.4}
          baseLine={0}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type={curveType}
          dataKey="negative_pnl"
          stroke={COLORS.red}
          strokeWidth={2}
          fill={`url(#${negativeGradientId})`}
          fillOpacity={0.4}
          baseLine={0}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        {markers.runup ? (
          <ReferenceDot
            x={markers.runup.time}
            y={markers.runup.pnl}
            r={5}
            fill={COLORS.green}
            stroke="#fff"
            strokeWidth={1}
            ifOverflow="extendDomain"
            isFront
          />
        ) : null}
        {markers.drawdown ? (
          <ReferenceDot
            x={markers.drawdown.time}
            y={markers.drawdown.pnl}
            r={5}
            fill={COLORS.red}
            stroke="#fff"
            strokeWidth={1}
            ifOverflow="extendDomain"
            isFront
          />
        ) : null}
      </AreaChart>
    </ChartContainer>
  )
}

/** Map simulate API equity rows → CurvePoint[] */
export function equityToCurvePoints(
  equity: { t: string; equity: number; drawdown?: number }[],
): CurvePoint[] {
  return equity.map((p) => ({
    t: p.t,
    value: p.equity,
    meta: p.drawdown != null ? { Drawdown: p.drawdown } : undefined,
  }))
}

/** Map price series to Δ from first price (signed area around 0). */
export function priceSeriesToDeltaCurve(
  series: { t: string; price: number; spread?: number | null }[],
): CurvePoint[] {
  if (series.length === 0) return []
  const base = series[0].price
  return series.map((p) => ({
    t: p.t,
    value: p.price - base,
    meta: {
      Price: p.price,
      ...(p.spread != null ? { Spread: p.spread } : {}),
    },
  }))
}
