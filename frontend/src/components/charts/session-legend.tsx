/**
 * Standard FX session windows in UTC (textbook hours).
 * Asia = Sydney open → Tokyo close.
 * Europe+US = London open → New York close.
 */
export const SESSION_DEFS = [
  {
    id: "asia",
    label: "Asia (Sydney + Tokyo)",
    color: "#818cf8",
    /** UTC open hour (may be previous calendar day relative to close) */
    utcOpen: 22,
    utcClose: 9,
    overnight: true,
  },
  {
    id: "europe_us",
    label: "Europe + US (London + NY)",
    color: "#34d399",
    utcOpen: 8,
    utcClose: 22,
    overnight: false,
  },
] as const

const TZ_SHORT: Record<string, string> = {
  UTC: "UTC",
  "America/New_York": "New York",
  "Europe/London": "London",
  "Europe/Bucharest": "Bucharest",
  "Asia/Tokyo": "Tokyo",
  "Australia/Sydney": "Sydney",
}

function msToLocalYmd(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone })
}

/** Format a UTC hour on a reference date into the selected timezone clock. */
function formatUtcHourInTz(
  utcY: number,
  utcM: number,
  utcD: number,
  utcHour: number,
  timeZone: string,
): string {
  return new Date(Date.UTC(utcY, utcM, utcD, utcHour, 0, 0)).toLocaleTimeString(
    "en-US",
    { timeZone, hour: "numeric", minute: "2-digit" },
  )
}

/** e.g. "1:00 AM – 12:00 PM" or "11:00 AM – 1:00 AM (+1)" in the selected TZ. */
export function formatSessionRangeInTz(
  utcOpen: number,
  utcClose: number,
  overnight: boolean,
  timeZone: string,
): string {
  // Mid-year UTC date (DST-aware for the chosen zone).
  const y = 2024
  const m = 5 // June
  const openD = 15
  const closeD = overnight || utcClose < utcOpen ? openD + 1 : openD
  const start = formatUtcHourInTz(y, m, openD, utcOpen, timeZone)
  const end = formatUtcHourInTz(y, m, closeD, utcClose, timeZone)
  const startDay = msToLocalYmd(Date.UTC(y, m, openD, utcOpen), timeZone)
  const endDay = msToLocalYmd(Date.UTC(y, m, closeD, utcClose), timeZone)
  return endDay !== startDay ? `${start} – ${end} (+1)` : `${start} – ${end}`
}

export function SessionLegend({
  timeZone,
  className,
}: {
  timeZone: string
  className?: string
}) {
  const tzShort = TZ_SHORT[timeZone] ?? timeZone
  return (
    <div
      className={
        className ??
        "border-b border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Sessions · {tzShort}
      </p>
      <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-1">
        {SESSION_DEFS.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-foreground/90">{s.label}</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatSessionRangeInTz(
                s.utcOpen,
                s.utcClose,
                s.overnight,
                timeZone,
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
