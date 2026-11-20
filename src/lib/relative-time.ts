const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Short relative label for session activity. Older activity falls back to a
 * localized month/day so the row stays honest without inventing month math.
 */
export function relativeActivityTime(updated: number, now = Date.now()): string {
  if (!Number.isFinite(updated)) return "unknown"
  const elapsed = Math.max(0, now - updated)
  const relative = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
    style: "narrow",
  })

  if (elapsed < MINUTE) return relative.format(-Math.floor(elapsed / 1000), "second")
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute")
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour")
  if (elapsed < 4 * WEEK) return relative.format(-Math.floor(elapsed / DAY), "day")
  if (elapsed < 8 * WEEK) return relative.format(-Math.floor(elapsed / WEEK), "week")

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(updated))
}

export function fullActivityTime(updated: number): string {
  if (!Number.isFinite(updated)) return "unknown"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updated))
}
