type DateInput = string | Date

function validDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dateTime(value: DateInput): number | null {
  return validDate(value)?.getTime() ?? null
}

export function isoDateString(value: DateInput = new Date()): string {
  return validDate(value)?.toISOString() ?? ""
}

export function isoDateStamp(value: DateInput = new Date()): string {
  return isoDateString(value).slice(0, 10)
}

export function compareDateAsc(a: DateInput, b: DateInput): number {
  return (
    (dateTime(a) ?? Number.POSITIVE_INFINITY) -
    (dateTime(b) ?? Number.POSITIVE_INFINITY)
  )
}

export function compareDateDesc(a: DateInput, b: DateInput): number {
  return (
    (dateTime(b) ?? Number.NEGATIVE_INFINITY) -
    (dateTime(a) ?? Number.NEGATIVE_INFINITY)
  )
}

function formatShortDate(value: DateInput): string {
  const date = validDate(value)
  if (!date) return ""
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export function formatCalendarDate(value: DateInput): string {
  const date = validDate(value)
  if (!date) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatDateTime(value: DateInput): string {
  const date = validDate(value)
  return date ? date.toLocaleString() : ""
}

export function formatRelativeTime(
  value: DateInput,
  now: number = Date.now()
): string {
  const date = validDate(value)
  if (!date) return ""
  const delta = Math.max(0, now - date.getTime())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return "just now"
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`
  return formatShortDate(date)
}
