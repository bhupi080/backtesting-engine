import {
  Activity,
  BarChart3,
  Crown,
  Database,
  Scale,
  Home,
  type LucideIcon,
} from "lucide-react"

export type PageMeta = {
  title: string
  icon: LucideIcon
  /** Tailwind text color for the icon */
  iconClass: string
}

/** Centered app-header title + icon for each route. */
export function pageMetaForPath(pathname: string): PageMeta {
  if (pathname === "/") {
    return {
      title: "Home",
      icon: Home,
      iconClass: "text-sky-500 dark:text-sky-400",
    }
  }
  if (pathname.startsWith("/datasets") || pathname.startsWith("/overview")) {
    return {
      title: "Datasets",
      icon: Database,
      iconClass: "text-emerald-500 dark:text-emerald-400",
    }
  }
  if (pathname.startsWith("/trades")) {
    return {
      title: "Trades",
      icon: BarChart3,
      iconClass: "text-violet-500 dark:text-violet-400",
    }
  }
  if (pathname.startsWith("/simulate")) {
    return {
      title: "Simulate",
      icon: Activity,
      iconClass: "text-rose-500 dark:text-rose-400",
    }
  }
  if (pathname.startsWith("/risk-reward/explorer")) {
    return {
      title: "TP / SL Grid",
      icon: Scale,
      iconClass: "text-orange-500 dark:text-orange-400",
    }
  }
  if (pathname.startsWith("/risk-reward")) {
    return {
      title: "Risk / Reward",
      icon: Scale,
      iconClass: "text-orange-500 dark:text-orange-400",
    }
  }
  if (pathname.startsWith("/vip/explorer")) {
    return {
      title: "TP / SL Grid",
      icon: Crown,
      iconClass: "text-amber-500 dark:text-amber-400",
    }
  }
  if (pathname.startsWith("/vip")) {
    return {
      title: "VIP",
      icon: Crown,
      iconClass: "text-amber-500 dark:text-amber-400",
    }
  }
  if (pathname.startsWith("/symbols")) {
    return {
      title: "Symbol",
      icon: BarChart3,
      iconClass: "text-sky-500 dark:text-sky-400",
    }
  }
  return {
    title: "Backtesting Engine",
    icon: Activity,
    iconClass: "text-primary",
  }
}

/** @deprecated use pageMetaForPath */
export function pageTitleForPath(pathname: string): string {
  return pageMetaForPath(pathname).title
}
