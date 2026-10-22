import { createFileRoute } from "@tanstack/react-router"

import { TradingSessions } from "@/components/trading-sessions"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return <TradingSessions />
}
