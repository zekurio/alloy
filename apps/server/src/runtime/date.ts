type DateLike = Date | string

export function isoDate(value: DateLike): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

export function dateFromDateLike(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value)
}

export function dateLikeTime(value: DateLike): number {
  return dateFromDateLike(value).getTime()
}

export function nullableIsoDate(value: DateLike | null): string | null {
  return value === null ? null : isoDate(value)
}
