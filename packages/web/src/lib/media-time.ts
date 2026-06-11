/** Sub-second readout for edit points, e.g. "1:03.4". */
export function formatTrimMs(ms: number): string {
  const totalDs = Math.max(0, Math.round(ms / 100))
  const ds = totalDs % 10
  const totalSec = Math.floor(totalDs / 10)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const secondText = (totalSec % 60).toString().padStart(2, "0")
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secondText}.${ds}`
  }
  return `${minutes}:${secondText}.${ds}`
}

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
