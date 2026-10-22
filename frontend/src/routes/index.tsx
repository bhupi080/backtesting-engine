import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Activity,
  Database,
  Scale,
  BarChart3,
  type LucideIcon,
} from "lucide-react"

import { TradingSessions } from "@/components/trading-sessions"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const features: {
  title: string
  to: "/datasets" | "/trades" | "/simulate" | "/compare"
  icon: LucideIcon
  color: string
  bgColor: string
  borderColor: string
  points: string[]
}[] = [
  {
    title: "Datasets",
    to: "/datasets",
    icon: Database,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    points: [
      "Day-by-day tick coverage on disk",
      "Update a symbol from the last saved tick",
      "Bootstrap a new symbol from cTrader",
    ],
  },
  {
    title: "Trades",
    to: "/trades",
    icon: BarChart3,
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    borderColor: "border-violet-200 dark:border-violet-800",
    points: [
      "TradingView strategy CSV exports",
      "Browse by symbol and strategy",
      "Open and close times used by every run",
    ],
  },
  {
    title: "Simulate",
    to: "/simulate",
    icon: Activity,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    borderColor: "border-rose-200 dark:border-rose-800",
    points: [
      "Fill at the signal or at bar close",
      "Tick PnL, MFE, and MAE",
      "Account equity and equity by trade",
    ],
  },
  {
    title: "Risk / Reward",
    to: "/compare",
    icon: Scale,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800",
    points: [
      "ATR from bars closed before the open",
      "Fixed take-profit and stop multiples",
      "Compare with the CSV exit",
      "Suggestion table across TP and SL ranges",
    ],
  },
]

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="space-y-6">
      <TradingSessions />

      <section className="grid w-full grid-cols-[4%_20%_4%_20%_4%_20%_4%_20%_4%]">
        {features.map((feature, index) => {
          const Icon = feature.icon
          return (
            <Link
              key={feature.to}
              to={feature.to}
              className="block min-w-0"
              style={{ gridColumn: index * 2 + 2 }}
            >
              <Card
                size="sm"
                className={`aspect-square w-full justify-between border-2 transition-shadow [--card-spacing:--spacing(4)] hover:shadow-md ${feature.borderColor} ${feature.bgColor}`}
              >
                <CardHeader className="flex flex-1 flex-col gap-3">
                  <div
                    className={`flex size-10 items-center justify-center rounded-lg ${feature.bgColor}`}
                  >
                    <Icon className={`size-5 ${feature.color}`} />
                  </div>
                  <CardTitle className="text-lg leading-tight">{feature.title}</CardTitle>
                  <ul className="flex flex-1 flex-col justify-evenly pl-4 text-sm leading-5 text-muted-foreground">
                    {feature.points.map((point) => (
                      <li key={point} className="list-disc">
                        {point}
                      </li>
                    ))}
                  </ul>
                </CardHeader>
                <CardContent>
                  <span className="text-sm font-medium text-muted-foreground">
                    Click to open →
                  </span>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </section>
    </div>
  )
}
