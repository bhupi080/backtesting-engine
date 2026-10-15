/** Convert datetime-local value to ISO-ish string for API, or undefined if empty. */
export function localInputToApi(value: string): string | undefined {
  if (!value) return undefined
  // datetime-local is "YYYY-MM-DDTHH:mm" — append Z-less local; backend casts as timestamptz
  return value.length === 16 ? `${value}:00` : value
}
