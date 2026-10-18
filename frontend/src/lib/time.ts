/** Convert datetime-local value to ISO-ish string for API, or undefined if empty. */
export function localInputToApi(value: string): string | undefined {
  if (!value) return undefined
  // datetime-local is "YYYY-MM-DDTHH:mm" — append Z-less local; backend casts as timestamptz
  return value.length === 16 ? `${value}:00` : value
}

/** Format "YYYY-MM" period keys as human-readable months. */
export function formatMonthPeriod(
  period: string,
  style: "short" | "long" = "short",
): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return period
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  return d.toLocaleDateString("en-US", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatHumanDate(
  iso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  })
}

export function formatHumanDateDetail(
  iso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone })
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
  return `${weekday} · ${time}`
}
