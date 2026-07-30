export type PlayerVolumeState = {
  volume: number
  muted: boolean
}

const STORAGE_KEY = "alloy.player-volume"
const DEFAULT_STATE: PlayerVolumeState = { volume: 1, muted: false }

export function readPlayerVolume(): PlayerVolumeState {
  if (typeof localStorage === "undefined") return DEFAULT_STATE

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (!isPlayerVolumeState(stored)) return DEFAULT_STATE
    return {
      volume: Math.max(0, Math.min(1, stored.volume)),
      muted: stored.muted,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function writePlayerVolume(state: PlayerVolumeState): void {
  if (typeof localStorage === "undefined") return

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        volume: Math.max(0, Math.min(1, state.volume)),
        muted: state.muted,
      }),
    )
  } catch {
    // Storage can be unavailable in privacy-restricted or embedded contexts.
  }
}

function isPlayerVolumeState(value: unknown): value is PlayerVolumeState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.volume === "number" &&
    Number.isFinite(candidate.volume) &&
    typeof candidate.muted === "boolean"
  )
}
