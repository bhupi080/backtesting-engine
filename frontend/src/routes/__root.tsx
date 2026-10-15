import {
  Outlet,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { ChevronsLeft, ChevronsRight } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { CandlestickBackground } from "@/components/candlestick-background"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { FiltersProvider } from "@/lib/filters"
import { pageMetaForPath } from "@/lib/page-title"
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
      className="rounded-lg border border-border bg-background/60"
    >
      {collapsed ? (
        <ChevronsRight className="size-4" />
      ) : (
        <ChevronsLeft className="size-4" />
      )}
    </SidebarTrigger>
  )
}

function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { title, icon: Icon, iconClass } = pageMetaForPath(pathname)

  return (
    <header className="relative z-10 grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-border/80 bg-muted/40 px-3 backdrop-blur-md dark:bg-muted/25">
      {/* Subtle trading grid — low contrast, no candles */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.25]"
        style={{
          backgroundImage: `
            linear-gradient(to right, color-mix(in oklch, var(--foreground) 8%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 8%, transparent) 1px, transparent 1px)
          `,
          backgroundSize: "28px 100%, 100% 12px",
        }}
      />
      {/* Soft center wash so the title reads clearly */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-[min(28rem,70%)] -translate-x-1/2 bg-gradient-to-r from-transparent via-background/80 to-transparent"
      />
      {/* Thin market accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"
      />

      <div className="relative z-10">
        <HeaderSidebarToggle />
      </div>
      <div className="relative z-10 flex min-w-0 items-center justify-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/80 ring-1 ring-border/80">
          <Icon className={`size-3.5 ${iconClass}`} />
        </span>
        <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
          {title}
        </h1>
      </div>
      <div className="relative z-10">
        <ThemeToggle />
      </div>
    </header>
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
                <AppHeader />
                <main className="relative z-10 flex flex-1 flex-col gap-2 p-3">
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
