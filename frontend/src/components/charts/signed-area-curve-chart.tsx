import { useId, useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
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

export type SessionBand = {
  start: number
  end: number
  label: string
  color: string
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
  /** Background session bands (e.g. Sydney/Tokyo vs London/NY) */
  sessionBands?: SessionBand[]
  timeZone?: string
  formatValue?: (n: number) => string
  /** Optional fixed X-axis domain in ms. Falls back to data min/max. */
  domain?: [number, number]
}

const COLORS = {
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  grid: "#bfbfbfff",
  tick: "#666",
  cursor: "#bfbfbf",
} as const

const EXIT_DOT: Record<string, string> = {
  "Take profit": COLORS.green,
  Stop: COLORS.red,
  "CSV exit": COLORS.amber,
}

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
  sessionBands,
  timeZone = "Europe/Bucharest",
  formatValue = defaultFormatUsd,
  domain,
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
    if (domain) return domain
    if (displayData.length === 0) return [0, 1]
    return [
      Math.min(...displayData.map((d) => d.time)),
      Math.max(...displayData.map((d) => d.time)),
    ]
  }, [displayData, domain])

  const ticks = useMemo(() => {
    if (displayData.length === 0) return []
    const [min, max] = xDomain
    const span = max - min || 1
    const MS_PER_HOUR = 60 * 60 * 1000
    // For a fixed 24h calendar-day domain, pin ticks to 00:00 / 06:00 / 12:00 / 18:00 / 24:00
    // so every trade card aligns regardless of when the trade itself opened.
    if (
      domain &&
      Math.abs(span - 24 * MS_PER_HOUR) < MS_PER_HOUR
    ) {
      return [
        min,
        min + 6 * MS_PER_HOUR,
        min + 12 * MS_PER_HOUR,
        min + 18 * MS_PER_HOUR,
        max,
      ]
    }
    const step = span / 4
    return [min, min + step, min + 2 * step, min + 3 * step, max]
  }, [displayData, xDomain, domain])

  const xAxisFormatter = useMemo(() => {
    const [min, max] = xDomain
    const spanMs = max - min
    const spanHours = spanMs / (1000 * 60 * 60)
    if (spanHours <= 24) {
      return (value: number) =>
        new Date(value).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        })
    }
    if (spanHours <= 24 * 7) {
      return (value: number) =>
        new Date(value).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          timeZone,
        })
    }
    return (value: number) =>
      new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone,
      })
  }, [xDomain, timeZone])

  const exitDots = useMemo(() => {
    return displayData.flatMap((p) => {
      const exit = p.meta?.Exit
      if (typeof exit !== "string" || EXIT_DOT[exit] == null) return []
      return [
        {
          key: `${p.time}-${exit}`,
          time: p.time,
          pnl: p.pnl,
          fill: EXIT_DOT[exit],
        },
      ]
    })
  }, [displayData])

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
      className={cn(
        "aspect-auto w-full justify-center",
        className ?? "h-48",
      )}
    >
      <AreaChart
        data={displayData}
        margin={{ top: 8, right: 4, left: 8, bottom: 2 }}
      >
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
        {sessionBands?.map((band) => (
          <ReferenceArea
            key={`${band.label}-${band.start}`}
            x1={band.start}
            x2={band.end}
            fill={band.color}
            fillOpacity={0.12}
            strokeOpacity={0}
            ifOverflow="hidden"
          />
        ))}
        <CartesianGrid
          vertical={false}
          horizontal={false}
          strokeOpacity={1}
          stroke={COLORS.grid}
        />
        <XAxis
          dataKey="time"
          domain={xDomain}
          type="number"
          allowDataOverflow={Boolean(domain)}
          tickFormatter={xAxisFormatter}
          axisLine={false}
          tickLine={false}
          minTickGap={30}
          ticks={ticks}
          interval={0}
          tick={(props) => {
            const { x, y, payload, index } = props as {
              x: number
              y: number
              payload: { value: number }
              index: number
            }
            const isFirst = index === 0
            const isLast = index === ticks.length - 1
            return (
              <text
                x={x}
                y={y + 10}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                fill={COLORS.tick}
                fontSize={10}
              >
                {xAxisFormatter(payload.value)}
              </text>
            )
          }}
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
            const session = sessionBands?.find(
              (b) => point.time! >= b.start && point.time! < b.end,
            )
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
                  {session ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: session.color }}
                      />
                      <span>
                        Session:{" "}
                        <span className="font-medium text-foreground/90">
                          {session.label}
                        </span>
                      </span>
                    </div>
                  ) : null}
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
          />
        ) : null}
        {exitDots.map((dot) => (
          <ReferenceDot
            key={dot.key}
            x={dot.time}
            y={dot.pnl}
            r={3.5}
            fill={dot.fill}
            stroke="#fff"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}

/** Map simulate API equity rows → CurvePoint[] */
const EXIT_LABEL: Record<string, string> = {
  tp: "Take profit",
  sl: "Stop",
  signal: "CSV exit",
}

export function equityToCurvePoints(
  equity: {
    t: string
    equity: number
    drawdown?: number
    exitReason?: string | null
  }[],
): CurvePoint[] {
  return equity.map((p) => {
    const meta: Record<string, number | string | null | undefined> = {}
    if (p.drawdown != null) meta.Drawdown = p.drawdown
    const exit = p.exitReason ? EXIT_LABEL[p.exitReason] : undefined
    if (exit) meta.Exit = exit
    return {
      t: p.t,
      value: p.equity,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    }
  })
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
