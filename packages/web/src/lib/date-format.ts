import { getRuntimeLocale, localeToLanguageTag } from "@alloy/i18n"
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
  return date.toLocaleDateString(localeToLanguageTag(getRuntimeLocale()), {
    month: "short",
    day: "numeric",
  })
}

export function formatCalendarDate(value: DateInput): string {
  const date = validDate(value)
  if (!date) return ""
  return date.toLocaleDateString(localeToLanguageTag(getRuntimeLocale()), {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatDateTime(value: DateInput): string {
  const date = validDate(value)
  return date
    ? date.toLocaleString(localeToLanguageTag(getRuntimeLocale()))
    : ""
}

export function formatRelativeTime(
  value: DateInput,
  now: number = Date.now(),
): string {
  const date = validDate(value)
  if (!date) return ""
  const delta = date.getTime() - now
  const absoluteDelta = Math.abs(delta)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const formatter = new Intl.RelativeTimeFormat(
    localeToLanguageTag(getRuntimeLocale()),
    {
      numeric: "auto",
      style: "short",
    },
  )
  if (absoluteDelta < minute) return formatter.format(0, "second")
  if (absoluteDelta < hour)
    return formatter.format(relativeUnit(delta, minute), "minute")
  if (absoluteDelta < day)
    return formatter.format(relativeUnit(delta, hour), "hour")
  if (absoluteDelta < 7 * day)
    return formatter.format(relativeUnit(delta, day), "day")
  return formatShortDate(date)
}

function relativeUnit(delta: number, unit: number): number {
  return delta < 0 ? Math.ceil(delta / unit) : Math.floor(delta / unit)
}
