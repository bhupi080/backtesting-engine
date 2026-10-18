import { useMemo, type ReactNode } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import { PreciseEquityCurveChart, type EquityPoint } from "@/components/charts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { formatMonthPeriod } from "@/lib/time"
import { cn } from "@/lib/utils"

type SimSummary = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/api").api.simulate>>["summary"]
>

type SimTrade = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/api").api.simulate>>["trades"]
>[number]

const usd = (n: number | null | undefined, digits = 2) => {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const pnl = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${usd(n)}`
}

const pnlClass = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n) || n === 0) return "text-muted-foreground"
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400"
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—"
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatClock(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
}

function tradeDurationMs(t: SimTrade): number | null {
  if (!t.fill_entry_time || !t.fill_exit_time) return null
  const a = Date.parse(t.fill_entry_time)
  const b = Date.parse(t.fill_exit_time)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
  return b - a
}

function MetricCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <Card size="sm" className="gap-2 py-3">
      <CardHeader className="px-4 pb-0">
        <CardDescription className="text-[10px] font-semibold uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pt-0">
        <p
          className={cn(
            "font-mono text-lg font-semibold tracking-tight tabular-nums",
            valueClass,
          )}
        >
          {value}
        </p>
        {sub ? (
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card size="sm" className={cn("gap-3", className)}>
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm font-semibold tracking-tight">
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="text-[11px]">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  )
}

function SimpleTooltip({
  active,
  payload,
  label,
  valueFmt = (n: number) => `$${usd(n)}`,
}: {
  active?: boolean
  payload?: { value?: number; name?: string; color?: string; dataKey?: string }[]
  label?: string
  valueFmt?: (n: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      {label ? (
        <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>
      ) : null}
      <div className="space-y-1">
        {payload.map((p, i) =>
          p.value == null ? null : (
            <div key={i} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-muted-foreground">
                {p.name ?? p.dataKey}:
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {valueFmt(Number(p.value))}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function SimOverviewPanel({
  summary,
  equity,
  trades,
  timeZone,
}: {
  summary: SimSummary
  equity: EquityPoint[]
  trades: SimTrade[]
  timeZone: string
}) {
  const filled = useMemo(
    () =>
      trades.filter(
        (t) => (t.status ?? "ok") === "ok" && t.net_pnl_usd != null,
      ),
    [trades],
  )

  const derived = useMemo(() => {
    let commission = 0
    let longestWin: number | null = null
    let longestLoss: number | null = null

    for (const t of filled) {
      commission += t.commission_usd ?? 0
      const dur = tradeDurationMs(t)
      if (dur == null) continue
      if ((t.net_pnl_usd ?? 0) >= 0) {
        longestWin = longestWin == null ? dur : Math.max(longestWin, dur)
      } else {
        longestLoss = longestLoss == null ? dur : Math.max(longestLoss, dur)
      }
    }

    // Account MFE / MAE from starting balance (equity series is already PnL).
    let accountMfe = 0
    let accountMfeTime: string | null = null
    let accountMae = 0
    let accountMaeTime: string | null = null
    for (const p of equity) {
      if (p.equity > accountMfe) {
        accountMfe = p.equity
        accountMfeTime = p.t
      }
      if (p.equity < accountMae) {
        accountMae = p.equity
        accountMaeTime = p.t
      }
    }

    return {
      commission,
      accountMfe,
      accountMfeTime,
      accountMae,
      accountMaeTime,
      longestWin,
      longestLoss,
    }
  }, [filled, equity])

  const a = summary.analytics
  const totalTrades = summary.wins + summary.losses || summary.filled
  const pfLabel =
    summary.profit_factor == null
      ? "∞"
      : summary.profit_factor.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })

  const distData = [
    { name: "wins", label: "Wins", value: summary.wins, fill: "#10b981" },
    { name: "losses", label: "Losses", value: summary.losses, fill: "#f43f5e" },
  ].filter((d) => d.value > 0)

  const distConfig = {
    wins: { label: "Wins", color: "#10b981" },
    losses: { label: "Losses", color: "#f43f5e" },
  } satisfies ChartConfig

  const compareData = [
    { name: "Simulated", pnl: summary.sim_pnl_usd, fill: "#0ea5e9" },
    { name: "TradingView", pnl: summary.tv_pnl_usd, fill: "#8b5cf6" },
  ]

  const compareConfig = {
    pnl: { label: "PnL" },
    Simulated: { label: "Simulated", color: "#0ea5e9" },
    TradingView: { label: "TradingView", color: "#8b5cf6" },
  } satisfies ChartConfig

  const monthlyData = (a?.monthly_pnls ?? []).map((m) => ({
    month: formatMonthPeriod(m.period, "short"),
    period: m.period,
    periodLabel: formatMonthPeriod(m.period, "long"),
    pnl: m.pnl_usd,
    fill: m.pnl_usd >= 0 ? "#10b981" : "#f43f5e",
  }))

  const monthlyConfig = {
    pnl: { label: "PnL", color: "var(--chart-1)" },
  } satisfies ChartConfig

  const sessionData = Object.entries(a?.session_pnls ?? {}).map(
    ([key, value]) => ({
      session: key === "sydney_tokyo" ? "Asia" : "Europe+US",
      pnl: value,
      fill: key === "sydney_tokyo" ? "#818cf8" : "#34d399",
    }),
  )

  const sessionConfig = {
    pnl: { label: "PnL" },
    Asia: { label: "Asia", color: "#818cf8" },
    "Europe+US": { label: "Europe+US", color: "#34d399" },
  } satisfies ChartConfig

  const durationData = [
    {
      name: "Shortest win",
      minutes: (a?.shortest_win_ms ?? 0) / 60_000,
      fill: "#10b981",
    },
    {
      name: "Longest win",
      minutes: (derived.longestWin ?? 0) / 60_000,
      fill: "#059669",
    },
    {
      name: "Shortest loss",
      minutes: (a?.shortest_loss_ms ?? 0) / 60_000,
      fill: "#f43f5e",
    },
    {
      name: "Longest loss",
      minutes: (derived.longestLoss ?? 0) / 60_000,
      fill: "#e11d48",
    },
  ].filter((d) => d.minutes > 0)

  const durationConfig = {
    minutes: { label: "Minutes", color: "var(--chart-2)" },
  } satisfies ChartConfig

  const sideData = (
    [
      { key: "long" as const, label: "Long", fill: "#10b981" },
      { key: "short" as const, label: "Short", fill: "#f43f5e" },
    ] as const
  )
    .map(({ key, label, fill }) => {
      const s = summary.by_side?.[key]
      if (!s || s.filled === 0) return null
      return {
        name: key,
        label,
        value: s.filled,
        pnl: s.pnl_usd,
        fill,
      }
    })
    .filter((d): d is NonNullable<typeof d> => d != null)

  const sideConfig = {
    long: { label: "Long", color: "#10b981" },
    short: { label: "Short", color: "#f43f5e" },
  } satisfies ChartConfig

  return (
    <div className="space-y-4 p-3 pb-8">
      {/* KPI metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total PnL"
          value={`${pnl(summary.sim_pnl_usd)}`}
          sub={`${pnl(summary.return_pct)}%`}
          valueClass={pnlClass(summary.sim_pnl_usd)}
        />
        <MetricCard
          label="Commission"
          value={`$${usd(derived.commission)}`}
          sub="round-trip total"
        />
        <MetricCard
          label="MFE"
          value={`$${usd(derived.accountMfe)}`}
          sub={
            formatClock(derived.accountMfeTime, timeZone) ??
            "max favorable from start"
          }
          valueClass="text-emerald-600 dark:text-emerald-400"
        />
        <MetricCard
          label="MAE"
          value={`${pnl(derived.accountMae)}`}
          sub={
            formatClock(derived.accountMaeTime, timeZone) ??
            "max adverse from start"
          }
          valueClass="text-rose-600 dark:text-rose-400"
        />
        <MetricCard
          label="Profit factor"
          value={pfLabel}
          sub={`Δ ${pnl(summary.pnl_diff_usd)} vs TV`}
        />
        <MetricCard
          label="Win rate"
          value={`${usd(summary.win_rate * 100, 1)}%`}
          sub={`${summary.wins}W / ${summary.losses}L`}
        />
      </div>

      {/* Equity curve */}
      <ChartCard
        title="Account equity"
        description={`Ending $${usd(summary.ending_equity)} · ${pnl(summary.return_pct)}% return`}
      >
        <PreciseEquityCurveChart
          equity={equity}
          emptyMessage="No equity points (no tick fills)"
          showExtremumStats
          timeZone={timeZone}
        />
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Trades distribution donut */}
        <ChartCard title="Trades distribution" description="Wins vs losses">
          <ChartContainer
            config={distConfig}
            className="mx-auto aspect-square max-h-[220px]"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={({ active, payload }) => (
                  <SimpleTooltip
                    active={active}
                    payload={payload?.map((p) => ({
                      value: Number(p.value),
                      name: String(
                        (p.payload as { label?: string })?.label ?? p.name,
                      ),
                      color: String(p.payload?.fill ?? p.color),
                    }))}
                    valueFmt={(n) => `${n} trades`}
                  />
                )}
              />
              <Pie
                data={distData}
                dataKey="value"
                nameKey="label"
                innerRadius={58}
                outerRadius={84}
                strokeWidth={0}
              >
                {distData.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox))
                      return null
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) - 6}
                          className="fill-foreground text-2xl font-bold"
                        >
                          {totalTrades}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 14}
                          className="fill-muted-foreground text-[11px]"
                        >
                          Total trades
                        </tspan>
                      </text>
                    )
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-1 flex justify-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-emerald-500" />
              Wins {summary.wins}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-rose-500" />
              Losses {summary.losses}
            </span>
          </div>
        </ChartCard>

        {/* Sim vs TV */}
        <ChartCard
          title="Actual vs simulated PnL"
          description={`Difference ${pnl(summary.pnl_diff_usd)}`}
        >
          <ChartContainer config={compareConfig} className="h-[220px] w-full">
            <BarChart
              accessibilityLayer
              data={compareData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `$${usd(Number(v), 0)}`}
              />
              <ChartTooltip
                cursor={false}
                content={({ active, payload, label }) => (
                  <SimpleTooltip
                    active={active}
                    label={String(label ?? "")}
                    payload={payload?.map((p) => ({
                      value: Number(p.value),
                      name: "PnL",
                      color: String(
                        (p.payload as { fill?: string })?.fill ?? p.color,
                      ),
                    }))}
                  />
                )}
              />
              <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                {compareData.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        {/* Monthly PnL */}
        <ChartCard title="Monthly PnL" description="Net by calendar month">
          {monthlyData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No monthly data
            </p>
          ) : (
            <ChartContainer config={monthlyConfig} className="h-[220px] w-full">
              <BarChart
                accessibilityLayer
                data={monthlyData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `$${usd(Number(v), 0)}`}
                />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as
                      | {
                          periodLabel?: string
                          pnl?: number
                          fill?: string
                        }
                      | undefined
                    return (
                      <SimpleTooltip
                        active={active}
                        label={row?.periodLabel}
                        payload={
                          row?.pnl == null
                            ? []
                            : [
                                {
                                  value: row.pnl,
                                  name: "PnL",
                                  color: row.fill,
                                },
                              ]
                        }
                      />
                    )
                  }}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((d) => (
                    <Cell key={d.period} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Session PnL */}
        <ChartCard
          title="Session PnL"
          description="Gross PnL stamped per UTC session while open (commission not split)"
        >
          {sessionData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No session data
            </p>
          ) : (
            <ChartContainer config={sessionConfig} className="h-[220px] w-full">
              <BarChart
                accessibilityLayer
                data={sessionData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="session"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `$${usd(Number(v), 0)}`}
                />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload, label }) => (
                    <SimpleTooltip
                      active={active}
                      label={String(label ?? "")}
                      payload={payload?.map((p) => ({
                        value: Number(p.value),
                        name: "PnL",
                        color: String(
                          (p.payload as { fill?: string })?.fill ?? p.color,
                        ),
                      }))}
                    />
                  )}
                />
                <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                  {sessionData.map((d) => (
                    <Cell key={d.session} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Duration */}
        <ChartCard
          title="Trade duration"
          description="Shortest & longest wins / losses"
        >
          {durationData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No duration data
            </p>
          ) : (
            <ChartContainer
              config={durationConfig}
              className="h-[220px] w-full"
            >
              <BarChart
                accessibilityLayer
                layout="vertical"
                data={durationData}
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    Number(v) >= 60
                      ? `${(Number(v) / 60).toFixed(1)}h`
                      : `${Math.round(Number(v))}m`
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={92}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as
                      | { name?: string; minutes?: number; fill?: string }
                      | undefined
                    return (
                      <SimpleTooltip
                        active={active}
                        label={row?.name}
                        payload={
                          row?.minutes == null
                            ? []
                            : [
                                {
                                  value: row.minutes,
                                  name: "Duration",
                                  color: row.fill,
                                },
                              ]
                        }
                        valueFmt={(n) => formatDuration(n * 60_000)}
                      />
                    )
                  }}
                />
                <Bar dataKey="minutes" radius={[0, 4, 4, 0]} barSize={18}>
                  {durationData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
          {a ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <span>
                Avg win{" "}
                <span className="font-mono text-foreground">
                  {formatDuration(a.avg_win_duration_ms)}
                </span>
              </span>
              <span>
                Avg loss{" "}
                <span className="font-mono text-foreground">
                  {formatDuration(a.avg_loss_duration_ms)}
                </span>
              </span>
            </div>
          ) : null}
        </ChartCard>

        {/* Long vs Short */}
        <ChartCard title="Long vs Short" description="Trade count by side">
          {sideData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No side breakdown
            </p>
          ) : (
            <>
              <ChartContainer
                config={sideConfig}
                className="mx-auto aspect-square max-h-[180px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={({ active, payload }) => (
                      <SimpleTooltip
                        active={active}
                        payload={payload?.map((p) => ({
                          value: Number(p.value),
                          name: String(
                            (p.payload as { label?: string })?.label ?? p.name,
                          ),
                          color: String(p.payload?.fill ?? p.color),
                        }))}
                        valueFmt={(n) => `${n} trades`}
                      />
                    )}
                  />
                  <Pie
                    data={sideData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={72}
                    strokeWidth={0}
                  >
                    {sideData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {sideData.map((d) => (
                  <div
                    key={d.name}
                    className="rounded-md border px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <span
                        className="size-2 rounded-sm"
                        style={{ backgroundColor: d.fill }}
                      />
                      {d.label}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 font-mono font-semibold tabular-nums",
                        pnlClass(d.pnl),
                      )}
                    >
                      {pnl(d.pnl)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
