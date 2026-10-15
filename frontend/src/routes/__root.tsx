import { Outlet, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { ChevronsLeft, ChevronsRight } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { CandlestickBackground } from "@/components/candlestick-background"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { FiltersProvider } from "@/lib/filters"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function HeaderSidebarToggle() {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"
  return (
    <SidebarTrigger
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="rounded-lg border border-border"
    >
      {collapsed ? (
        <ChevronsRight className="size-4" />
      ) : (
        <ChevronsLeft className="size-4" />
      )}
    </SidebarTrigger>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function RootLayout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <FiltersProvider>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset className="relative overflow-hidden">
                <CandlestickBackground />
                <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
                  <HeaderSidebarToggle />
                  <ThemeToggle />
                </header>
                <main className="relative z-10 flex flex-1 flex-col gap-4 p-4">
                  <Outlet />
                </main>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </FiltersProvider>
        <ReactQueryDevtools initialIsOpen={false} />
        <TanStackRouterDevtools position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
