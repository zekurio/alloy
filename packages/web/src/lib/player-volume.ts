import { t } from "@alloy/contracts/schema"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import { useSyncExternalStore } from "react"

export type PlayerVolumeState = {
  volume: number
  muted: boolean
}

const STORAGE_KEY = "alloy.player-volume"
const PERSIST_INTERVAL_MS = 200
const PlayerVolumeSchema = t.object({
  volume: t.number(),
  muted: t.boolean(),
})
const storage = createLocalStorageDriver(
  STORAGE_KEY,
  (value): PlayerVolumeState => {
    const result = PlayerVolumeSchema.safeParse(value)
    return result.success
      ? normalizePlayerVolume(result.data)
      : defaultPlayerVolume()
  },
)

const listeners = new Set<() => void>()
let state: PlayerVolumeState | null = null
let pendingPersistence: PlayerVolumeState | null = null
let persistTimer: number | null = null
let lastPersistedAt = 0
let listeningToWindow = false

export function usePlayerVolume(): PlayerVolumeState {
  return useSyncExternalStore(subscribePlayerVolume, readPlayerVolume)
}

/** The current volume, for handlers that must not wait for a render. */
export function readPlayerVolume(): PlayerVolumeState {
  state ??= storage.read()
  return state
}

export function writePlayerVolume(next: PlayerVolumeState): void {
  const normalized = normalizePlayerVolume(next)
  const current = readPlayerVolume()
  if (
    normalized.volume === current.volume &&
    normalized.muted === current.muted
  ) {
    return
  }

  state = normalized
  pendingPersistence = normalized
  schedulePersistence()
  for (const listener of listeners) listener()
}

export function flushPlayerVolume(): void {
  if (!pendingPersistence) return
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = null
  const pending = pendingPersistence
  pendingPersistence = null
  lastPersistedAt = Date.now()
  storage.write(pending)
}

function subscribePlayerVolume(listener: () => void): () => void {
  ensureWindowListeners()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function schedulePersistence(): void {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(
    flushPlayerVolume,
    Math.max(0, PERSIST_INTERVAL_MS - (Date.now() - lastPersistedAt)),
  )
}

function ensureWindowListeners(): void {
  if (listeningToWindow) return
  listeningToWindow = true
  window.addEventListener("storage", handleStorage)
  window.addEventListener("pagehide", flushPlayerVolume)
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = null
  pendingPersistence = null
  lastPersistedAt = Date.now()

  const next = storage.refresh()
  const current = readPlayerVolume()
  if (next.volume === current.volume && next.muted === current.muted) return
  state = next
  for (const listener of listeners) listener()
}

function normalizePlayerVolume(value: PlayerVolumeState): PlayerVolumeState {
  return {
    volume: Math.max(0, Math.min(1, value.volume)),
    muted: value.muted,
  }
}

function defaultPlayerVolume(): PlayerVolumeState {
  return { volume: 1, muted: false }
}
