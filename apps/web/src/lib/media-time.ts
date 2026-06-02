export function formatMediaDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0:00"

  const totalSec = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const secondText = seconds.toString().padStart(2, "0")

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secondText}`
  }
  return `${minutes}:${secondText}`
}
