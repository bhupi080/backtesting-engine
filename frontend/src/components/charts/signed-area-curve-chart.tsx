import { useId, useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, ChartTooltip } from "@/components/ui/chart"

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
  /** Tooltip / config label, e.g. "P&L" or "Δ price" */
  valueLabel?: string
  className?: string
  emptyMessage?: string
  /** Prepend a zero point just before the first sample */
  anchorAtZero?: boolean
  /**
   * @deprecated Level slabs removed — use showExtremumDots instead.
   * Kept so callers compiling against old prop don't break.
   */
  showLevelGuides?: boolean
  /** Green max-runup + red max-DD dots on the curve (default true) */
  showExtremumDots?: boolean
  /** Optional override (e.g. backend MAE/MFE times); else derived from series */
  extremumDots?: {
    maxRunup?: ExtremumDot | null
    maxDrawdown?: ExtremumDot | null
  }
  /** Interpolation: linear = honest ticks; monotone = smooth */
  curveType?: "linear" | "monotone" | "stepAfter"
  /** Timezone for axis + tooltip */
  timeZone?: string
  /** Format tooltip main value */
  formatValue?: (n: number) => string
}

const defaultFormatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

/**
 * Signed area equity curve: green above 0, red below, optional
 * max-runup (green) / max-DD (red) markers on the series extrema.
 */
export function SignedAreaCurveChart({
  data,
  valueLabel = "Value",
  className,
  emptyMessage = "No data",
  anchorAtZero = true,
  showExtremumDots = true,
  extremumDots,
  curveType = "linear",
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
      return { runup: null as ExtremumDot | null, drawdown: null as ExtremumDot | null }
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
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <ChartContainer
      config={{
        pnl: { label: valueLabel, color: "#22c55e" },
      }}
      className={className ?? "h-72 w-full aspect-auto"}
    >
      <AreaChart data={displayData}>
        <defs>
          <linearGradient id={positiveGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={negativeGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={true}
          strokeDasharray="3 3"
          horizontal={false}
          strokeOpacity={1}
          stroke="#bfbfbfff"
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
          tick={{ fontSize: 10, fill: "#666" }}
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
          width={48}
          tick={{ fontSize: 10, fill: "#666" }}
          tickFormatter={(value) =>
            new Intl.NumberFormat("en-US", {
              notation: "compact",
              compactDisplay: "short",
            }).format(value)
          }
        />
        <ChartTooltip
          cursor={{ stroke: "#bfbfbf", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const point = payload[0]?.payload as {
              time?: number
              pnl?: number
              meta?: CurvePoint["meta"]
            }
            const pnl = point?.pnl ?? 0
            return (
              <div className="rounded-lg border bg-background p-3 shadow-lg">
                <div className="space-y-2">
                  {point?.time != null && (
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
                  )}
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${pnl >= 0 ? "bg-green-500" : "bg-red-500"}`}
                    />
                    <span className="text-sm font-bold">
                      {valueLabel}: {formatValue(pnl)}
                    </span>
                  </div>
                  {point?.meta &&
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
          stroke={netProfit >= 0 ? "#22c55e" : "#ef4444"}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
        <Area
          type={curveType}
          dataKey="positive_pnl"
          stroke="#22c55e"
          strokeWidth={2}
          fill={`url(#${positiveGradientId})`}
          fillOpacity={0.4}
          baseLine={0}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type={curveType}
          dataKey="negative_pnl"
          stroke="#ef4444"
          strokeWidth={2}
          fill={`url(#${negativeGradientId})`}
          fillOpacity={0.4}
          baseLine={0}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3 }}
        />
        {markers.runup ? (
          <Scatter
            data={[markers.runup]}
            dataKey="pnl"
            fill="#22c55e"
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => {
              const { cx, cy } = props
              if (cx == null || cy == null) return <g />
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="#22c55e"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              )
            }}
          />
        ) : null}
        {markers.drawdown ? (
          <Scatter
            data={[markers.drawdown]}
            dataKey="pnl"
            fill="#ef4444"
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => {
              const { cx, cy } = props
              if (cx == null || cy == null) return <g />
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              )
            }}
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
