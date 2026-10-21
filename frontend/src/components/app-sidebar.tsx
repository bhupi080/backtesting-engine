import { Link, useRouterState } from "@tanstack/react-router"
import {
  Activity,
  BarChart3,
  Database,
  Scale,
  Home,
  type LucideIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import { api } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const nav: {
  to: string
  label: string
  icon: LucideIcon
  color: string
}[] = [
  { to: "/", label: "Home", icon: Home, color: "text-sky-400" },
  { to: "/datasets", label: "Datasets", icon: Database, color: "text-emerald-400" },
  { to: "/trades", label: "Trades", icon: BarChart3, color: "text-violet-400" },
  { to: "/simulate", label: "Simulate", icon: Activity, color: "text-rose-400" },
  { to: "/compare", label: "Risk / Reward", icon: Scale, color: "text-orange-400" },
]

export function AppSidebar() {
  const { hydrateFromCatalog } = useFilters()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets })
  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: api.strategies,
  })

  const datasetSymbols = useMemo(
    () => datasets.data?.map((d) => d.symbol) ?? [],
    [datasets.data],
  )
  const strategyList = strategies.data ?? []

  useEffect(() => {
    if (strategies.isSuccess || datasets.isSuccess) {
      hydrateFromCatalog(strategyList, datasetSymbols)
    }
  }, [
    strategies.isSuccess,
    datasets.isSuccess,
    strategyList,
    datasetSymbols,
    hydrateFromCatalog,
  ])

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/" />}
              tooltip="Backtesting Engine"
            >
              <img
                src="/favicon.svg"
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-full ring-1 ring-foreground/10"
              />
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">
                  Backtesting Engine
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Market & trades
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} />}
                    isActive={pathname === item.to}
                    tooltip={item.label}
                  >
                    <item.icon className={item.color} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
