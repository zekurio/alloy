import { useSyncExternalStore } from "react"

export type PlayerVolumeState = {
  volume: number
  muted: boolean
}

const STORAGE_KEY = "alloy.player-volume"
const PERSIST_INTERVAL_MS = 200
const SERVER_SNAPSHOT: PlayerVolumeState = { volume: 1, muted: false }

const listeners = new Set<() => void>()
let state: PlayerVolumeState | null = null
let pendingPersistence: PlayerVolumeState | null = null
let persistTimer: number | null = null
let lastPersistedAt = 0
let listeningToWindow = false

export function usePlayerVolume(): PlayerVolumeState {
  return useSyncExternalStore(
    subscribePlayerVolume,
    playerVolumeSnapshot,
    () => SERVER_SNAPSHOT,
  )
}

export function readPlayerVolume(): PlayerVolumeState {
  const current = playerVolumeSnapshot()
  return { volume: current.volume, muted: current.muted }
}

export function writePlayerVolume(next: PlayerVolumeState): void {
  const normalized = normalizePlayerVolume(next)
  const current = playerVolumeSnapshot()
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
  if (typeof localStorage === "undefined") return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Storage can be unavailable in privacy-restricted or embedded contexts.
  }
}

function subscribePlayerVolume(listener: () => void): () => void {
  ensureWindowListeners()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function playerVolumeSnapshot(): PlayerVolumeState {
  state ??= readStoredPlayerVolume()
  return state
}

function schedulePersistence(): void {
  if (persistTimer !== null || typeof window === "undefined") return
  persistTimer = window.setTimeout(
    flushPlayerVolume,
    Math.max(0, PERSIST_INTERVAL_MS - (Date.now() - lastPersistedAt)),
  )
}

function ensureWindowListeners(): void {
  if (listeningToWindow || typeof window === "undefined") return
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

  const next = parsePlayerVolume(event.newValue)
  const current = playerVolumeSnapshot()
  if (next.volume === current.volume && next.muted === current.muted) return
  state = next
  for (const listener of listeners) listener()
}

function readStoredPlayerVolume(): PlayerVolumeState {
  if (typeof localStorage === "undefined") return defaultPlayerVolume()

  try {
    return parsePlayerVolume(localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultPlayerVolume()
  }
}

function parsePlayerVolume(value: string | null): PlayerVolumeState {
  if (!value) return defaultPlayerVolume()

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isPlayerVolumeState(parsed)) return defaultPlayerVolume()
    return normalizePlayerVolume(parsed)
  } catch {
    return defaultPlayerVolume()
  }
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

function isPlayerVolumeState(value: unknown): value is PlayerVolumeState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.volume === "number" &&
    Number.isFinite(candidate.volume) &&
    typeof candidate.muted === "boolean"
  )
}
