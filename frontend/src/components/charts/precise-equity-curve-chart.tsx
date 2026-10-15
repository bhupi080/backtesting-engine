import {
  SignedAreaCurveChart,
  equityToCurvePoints,
  type SignedAreaCurveChartProps,
} from "@/components/charts/signed-area-curve-chart"

export type EquityPoint = {
  t: string
  equity: number
  drawdown?: number
}

type Props = {
  equity: EquityPoint[]
  className?: string
} & Pick<
  SignedAreaCurveChartProps,
  "emptyMessage" | "showLevelGuides" | "timeZone"
>

/** Equity-curve convenience wrapper around SignedAreaCurveChart. */
export function PreciseEquityCurveChart({
  equity,
  className,
  emptyMessage = "No equity points",
  showLevelGuides = true,
  timeZone,
}: Props) {
  return (
    <SignedAreaCurveChart
      data={equityToCurvePoints(equity)}
      valueLabel="P&L"
      className={className}
      emptyMessage={emptyMessage}
      anchorAtZero
      showLevelGuides={showLevelGuides}
      timeZone={timeZone}
    />
  )
}
