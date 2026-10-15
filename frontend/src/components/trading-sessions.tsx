import { useEffect, useMemo, useState } from "react"

import { cn } from "cn"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type SessionDef = {
  id: string
  name: string
  timeZone: string
  open: string
  close: string
  bar: string
  chip: string
  text: string
  glow: string
}

const SESSIONS: SessionDef[] = [
  {
    id: "sydney",
    name: "Sydney",
    timeZone: "Australia/Sydney",
    open: "07:00",
    close: "16:00",
    bar: "bg-amber-500/70",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    text: "text-amber-600 dark:text-amber-400",
    glow: "hover:shadow-[0_0_20px_-4px] hover:shadow-amber-500/40",
  },
  {
    id: "tokyo",
    name: "Tokyo",
    timeZone: "Asia/Tokyo",
    open: "09:00",
    close: "18:00",
    bar: "bg-rose-500/70",
    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    text: "text-rose-600 dark:text-rose-400",
    glow: "hover:shadow-[0_0_20px_-4px] hover:shadow-rose-500/40",
  },
  {
    id: "london",
    name: "London",
    timeZone: "Europe/London",
    open: "08:00",
    close: "16:30",
    bar: "bg-sky-500/70",
    chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    text: "text-sky-600 dark:text-sky-400",
    glow: "hover:shadow-[0_0_20px_-4px] hover:shadow-sky-500/40",
  },
  {
    id: "newyork",
    name: "New York",
    timeZone: "America/New_York",
    open: "08:00",
    close: "17:00",
    bar: "bg-violet-500/70",
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    text: "text-violet-600 dark:text-violet-400",
    glow: "hover:shadow-[0_0_20px_-4px] hover:shadow-violet-500/40",
  },
]

const TZ_STORAGE_KEY = "bt-viewer-timezone"

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/Bucharest", label: "Bucharest (EET)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin / Paris" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
]

const DAY_MIN = 24 * 60
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

type Segment = { start: number; end: number }

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number)
  return h * 60 + m
}

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value
  }
  return {
    weekday: map.weekday ?? "",
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const parts = zonedParts(new Date(guess), timeZone)
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return new Date(guess - (asIfUtc - guess))
}

function formatAmPm(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

function formatAmPmFromMinutes(mins: number): string {
  const total = ((Math.floor(mins) % DAY_MIN) + DAY_MIN) % DAY_MIN
  const d = new Date()
  d.setHours(Math.floor(total / 60), total % 60, 0, 0)
  return formatAmPm(d)
}

function formatTzAbbrev(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date)
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone
}

function formatViewerDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date)
}

function viewerDayBounds(now: Date, viewerTz: string): { start: Date; end: Date } {
  const p = zonedParts(now, viewerTz)
  const start = zonedWallToUtc(p.year, p.month, p.day, 0, 0, viewerTz)
  return { start, end: new Date(start.getTime() + DAY_MIN * 60_000) }
}

function minutesInViewer(now: Date, viewerTz: string): number {
  const p = zonedParts(now, viewerTz)
  return p.hour * 60 + p.minute + p.second / 60
}

function sessionOpenCloseUtc(
  now: Date,
  session: SessionDef,
  dayOffset: number,
): { open: Date; close: Date } {
  const base = new Date(now.getTime() + dayOffset * DAY_MIN * 60_000)
  const p = zonedParts(base, session.timeZone)
  const openM = parseHm(session.open)
  const closeM = parseHm(session.close)
  const open = zonedWallToUtc(
    p.year,
    p.month,
    p.day,
    Math.floor(openM / 60),
    openM % 60,
    session.timeZone,
  )
  let close = zonedWallToUtc(
    p.year,
    p.month,
    p.day,
    Math.floor(closeM / 60),
    closeM % 60,
    session.timeZone,
  )
  if (close <= open) close = new Date(close.getTime() + DAY_MIN * 60_000)
  return { open, close }
}

function sessionSegmentsInViewerDay(
  now: Date,
  session: SessionDef,
  viewerTz: string,
): Segment[] {
  const { start: dayStart, end: dayEnd } = viewerDayBounds(now, viewerTz)
  const segs: Segment[] = []

  for (const offset of [-1, 0, 1]) {
    const { open, close } = sessionOpenCloseUtc(now, session, offset)
    const start = Math.max(open.getTime(), dayStart.getTime())
    const end = Math.min(close.getTime(), dayEnd.getTime())
    if (end <= start) continue
    segs.push({
      start: (start - dayStart.getTime()) / 60_000,
      end: (end - dayStart.getTime()) / 60_000,
    })
  }
  return segs
}

function isSessionOpenNow(now: Date, session: SessionDef): boolean {
  const p = zonedParts(now, session.timeZone)
  if (p.weekday === "Sat" || p.weekday === "Sun") return false
  const mins = p.hour * 60 + p.minute
  const open = parseHm(session.open)
  const close = parseHm(session.close)
  if (close > open) return mins >= open && mins < close
  return mins >= open || mins < close
}

function detectBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function readStoredTz(): string {
  try {
    const stored = localStorage.getItem(TZ_STORAGE_KEY)
    if (stored) return stored
  } catch {
    /* ignore */
  }
  return detectBrowserTz()
}

function tzLabel(value: string): string {
  return (
    TIMEZONE_OPTIONS.find((o) => o.value === value)?.label ??
    value.replaceAll("_", " ")
  )
}

export function TradingSessions() {
  const [now, setNow] = useState(() => new Date())
  const [viewerTz, setViewerTz] = useState(detectBrowserTz)
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    setViewerTz(readStoredTz())
  }, [])

  useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const timezoneOptions = useMemo(() => {
    const browser = detectBrowserTz()
    const list = [...TIMEZONE_OPTIONS]
    if (!list.some((o) => o.value === browser)) {
      list.unshift({
        value: browser,
        label: `${browser.replaceAll("_", " ")} (detected)`,
      })
    }
    if (!list.some((o) => o.value === viewerTz)) {
      list.unshift({
        value: viewerTz,
        label: viewerTz.replaceAll("_", " "),
      })
    }
    return list
  }, [viewerTz])

  const nowMin = minutesInViewer(now, viewerTz)
  const viewerAbbrev = formatTzAbbrev(now, viewerTz)

  const lanes = useMemo(
    () =>
      SESSIONS.map((session) => {
        const open = isSessionOpenNow(now, session)
        const { open: openUtc, close: closeUtc } = sessionOpenCloseUtc(
          now,
          session,
          0,
        )
        const cityRange = `${formatAmPm(openUtc, session.timeZone)} – ${formatAmPm(closeUtc, session.timeZone)}`
        const viewerRange = `${formatAmPm(openUtc, viewerTz)} – ${formatAmPm(closeUtc, viewerTz)}`
        return {
          session,
          open,
          segments: sessionSegmentsInViewerDay(now, session, viewerTz),
          cityClock: formatAmPm(now, session.timeZone),
          cityTz: formatTzAbbrev(now, session.timeZone),
          cityRange,
          viewerRange,
        }
      }),
    [now, viewerTz],
  )

  const openNames = lanes.filter((l) => l.open).map((l) => l.session.name)

  function onTimezoneChange(value: string | null) {
    if (!value) return
    setViewerTz(value)
    try {
      localStorage.setItem(TZ_STORAGE_KEY, value)
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Trading sessions
          </h2>
          <p className="text-xs text-muted-foreground">
            {openNames.length
              ? `Open now: ${openNames.join(" · ")}`
              : "All sessions closed"}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={viewerTz} onValueChange={onTimezoneChange}>
            <SelectTrigger size="sm" className="min-w-[12rem] rounded-xl">
              <SelectValue placeholder="Your timezone">
                {tzLabel(viewerTz)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezoneOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/15 px-3 py-1.5 text-sm ring-1 ring-inset ring-sky-400/50">
            <span className="size-2 animate-pulse rounded-full bg-sky-400 shadow-[0_0_8px] shadow-sky-400/80" />
            <span className="text-[11px] font-semibold tracking-wide text-sky-300 uppercase">
              You are here
            </span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatAmPm(now, viewerTz)}
            </span>
            <span className="hidden text-xs text-sky-200/70 md:inline">
              {formatViewerDate(now, viewerTz)} · {viewerAbbrev}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-card/60 p-3 ring-1 ring-foreground/10 backdrop-blur-sm sm:p-4">
        <p className="mb-3 text-[11px] text-muted-foreground">
          Timeline shown in{" "}
          <span className="font-medium text-foreground">
            {tzLabel(viewerTz)}
          </span>
          {" "}
          · hover a session for details
        </p>

        <div className="relative pt-6">
          {/* Shared "you are here" marker — must use left/right so % maps to ribbon width */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-[5.5rem] right-[4.5rem] z-20 sm:left-[6.5rem] sm:right-[8.5rem]"
          >
            <div
              className="absolute top-0 bottom-4 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${(nowMin / DAY_MIN) * 100}%` }}
            >
              <div className="absolute top-0 z-30 -translate-y-0.5">
                <div className="flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap text-primary-foreground shadow-lg shadow-primary/40 ring-2 ring-background">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground/80 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
                  </span>
                  <span className="tracking-wide uppercase">Now</span>
                  <span className="font-mono tabular-nums">
                    {formatAmPm(now, viewerTz)}
                  </span>
                </div>
                <div className="mx-auto h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-primary" />
              </div>

              <div className="mt-7 h-full w-0.5 rounded-full bg-gradient-to-b from-primary via-primary to-primary/30" />
              <div className="absolute top-7 bottom-0 left-1/2 w-6 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            </div>
          </div>

          <div className="space-y-2">
            {lanes.map((lane) => {
              const {
                session,
                open,
                segments,
                cityClock,
                cityTz,
                cityRange,
                viewerRange,
              } = lane
              const isHot = hovered === session.id

              return (
                <Tooltip key={session.id}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          "grid cursor-default grid-cols-[5.5rem_1fr_auto] items-center gap-2 rounded-xl px-1 py-1 transition-all duration-200 sm:grid-cols-[6.5rem_1fr_8.5rem] sm:gap-3",
                          "hover:bg-muted/40",
                          isHot && "bg-muted/50 scale-[1.01]",
                          session.glow,
                        )}
                        onMouseEnter={() => setHovered(session.id)}
                        onMouseLeave={() => setHovered(null)}
                      />
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full transition-transform duration-200",
                            open ? "bg-emerald-500" : "bg-muted-foreground/35",
                            isHot && "scale-150",
                          )}
                        />
                        <span className="truncate text-xs font-medium sm:text-sm">
                          {session.name}
                        </span>
                      </div>
                    </div>

                    <div
                      className={cn(
                        "relative h-7 overflow-hidden rounded-md bg-muted/40 transition-all duration-200",
                        isHot && "h-8 ring-1 ring-foreground/15",
                      )}
                    >
                      {segments.map((seg, i) => (
                        <div
                          key={i}
                          className={cn(
                            "absolute top-1 bottom-1 rounded-sm transition-all duration-200",
                            session.bar,
                            open && "ring-1 ring-white/20",
                            isHot && "top-0.5 bottom-0.5 brightness-110",
                          )}
                          style={{
                            left: `${(seg.start / DAY_MIN) * 100}%`,
                            width: `${((seg.end - seg.start) / DAY_MIN) * 100}%`,
                          }}
                        />
                      ))}
                    </div>

                    <div className="min-w-0 text-right">
                      <div
                        className={cn(
                          "font-mono text-xs font-semibold tabular-nums sm:text-sm",
                          session.text,
                          isHot && "scale-105",
                        )}
                      >
                        {cityClock}
                      </div>
                      <div className="hidden truncate text-[10px] text-muted-foreground tabular-nums sm:block">
                        {cityTz}
                      </div>
                    </div>
                  </TooltipTrigger>

                  <TooltipContent
                    side="top"
                    className="w-56 flex-col items-stretch gap-2 rounded-xl border border-background/10 bg-zinc-900 px-3.5 py-3 text-left text-zinc-100 shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {session.name}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                          open
                            ? "bg-emerald-500/20 text-emerald-400 dark:text-emerald-700"
                            : "bg-zinc-500/20 text-zinc-400 dark:text-zinc-600",
                        )}
                      >
                        {open ? "Open" : "Closed"}
                      </span>
                    </div>

                    <div className="space-y-1.5 border-t border-current/10 pt-2 text-[11px]">
                      <div className="flex justify-between gap-3">
                        <span className="opacity-60">Now</span>
                        <span className="font-mono font-medium tabular-nums">
                          {cityClock}{" "}
                          <span className="opacity-60">{cityTz}</span>
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="opacity-60">Session</span>
                        <span className="text-right font-medium tabular-nums">
                          {cityRange}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="opacity-60">Your tz</span>
                        <span className="text-right font-medium tabular-nums">
                          {viewerRange}
                        </span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          <div className="relative mt-3 ml-[5.5rem] mr-[4.5rem] h-4 sm:ml-[6.5rem] sm:mr-[8.5rem]">
            {HOUR_TICKS.map((h) => (
              <div
                key={h}
                className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums"
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {h === 24
                  ? "12 AM"
                  : formatAmPmFromMinutes(h * 60).replace(":00", "")}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
