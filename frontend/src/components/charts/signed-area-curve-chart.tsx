import { useId, useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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

export type SignedAreaCurveChartProps = {
  data: CurvePoint[]
  /** Tooltip / config label, e.g. "P&L" or "Δ price" */
  valueLabel?: string
  className?: string
  emptyMessage?: string
  /** Prepend a zero point just before the first sample */
  anchorAtZero?: boolean
  /** Show ±500 / ±1000 guide lines (equity-style) */
  showLevelGuides?: boolean
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
 * Reusable Precise-Equity-Curve visual (mt5-dashboard):
 * green area above 0, red below, gradients, vertical grid, reference levels.
 */
export function SignedAreaCurveChart({
  data,
  valueLabel = "Value",
  className,
  emptyMessage = "No data",
  anchorAtZero = true,
  showLevelGuides = true,
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
        {showLevelGuides &&
          [500, 1000, 1500, 2000].map((level) => (
            <ReferenceLine
              key={`pos-${level}`}
              y={level}
              stroke="#22c55e"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.3}
            />
          ))}
        {showLevelGuides &&
          [-500, -1000, -1500, -2000].map((level) => (
            <ReferenceLine
              key={`neg-${level}`}
              y={level}
              stroke="#ef4444"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.3}
            />
          ))}
        <Area
          type="monotone"
          dataKey="positive_pnl"
          stroke="#22c55e"
          strokeWidth={2}
          fill={`url(#${positiveGradientId})`}
          fillOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="negative_pnl"
          stroke="#ef4444"
          strokeWidth={2}
          fill={`url(#${negativeGradientId})`}
          fillOpacity={0.4}
        />
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
