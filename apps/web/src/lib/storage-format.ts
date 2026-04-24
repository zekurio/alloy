export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function formatQuotaGiB(quotaBytes: number | null): string {
  return quotaBytes === null ? "" : String(quotaBytes / 1024 / 1024 / 1024)
}

export function parseQuotaGiB(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const gib = Number(trimmed)
  if (!Number.isFinite(gib) || gib <= 0) {
    throw new Error("Quota must be blank or a positive GiB value.")
  }
  return Math.round(gib * 1024 * 1024 * 1024)
}

export function storageUsagePercent(
  usedBytes: number,
  quotaBytes: number | null
): number {
  if (quotaBytes === null || quotaBytes <= 0) return 0
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
}
