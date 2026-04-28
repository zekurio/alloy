const COUNT_UNITS = ["k", "m", "b", "t"] as const

/** 1,3k / 12,4k / 842 — truncated so counts never round up. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0"

  const sign = value < 0 ? "-" : ""
  const count = Math.trunc(Math.abs(value))

  if (count < 1_000) return `${sign}${count}`

  let divisor = 1_000
  let unitIndex = 0
  while (unitIndex < COUNT_UNITS.length - 1 && count >= divisor * 1_000) {
    divisor *= 1_000
    unitIndex += 1
  }

  const scaled = Math.trunc((count / divisor) * 10) / 10
  const formatted = Number.isInteger(scaled)
    ? String(scaled)
    : scaled.toFixed(1).replace(".", ",")

  return `${sign}${formatted}${COUNT_UNITS[unitIndex]}`
}
