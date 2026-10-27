import type { DesktopUpdateState } from "@alloy/contracts/desktop"
import { useSyncExternalStore } from "react"

import { alloyDesktop } from "@/lib/desktop"

const IDLE_STATE: DesktopUpdateState = {
  supported: false,
  status: "idle",
  currentVersion: null,
  version: null,
  lastCheckedAt: null,
  downloadProgress: null,
}

let snapshot: DesktopUpdateState = IDLE_STATE
const listeners = new Set<() => void>()
let started = false

/**
 * Shared renderer-side view of desktop updater state. The nav/footer update UI
 * warms this cache, so Settings > Updates can reuse the already-known state.
 */
function ensureStarted(): void {
  if (started) return
  started = true
  const desktop = alloyDesktop()
  if (!desktop) return
  const updates = desktop.updates

  let receivedStateEvent = false
  updates.onState((next) => {
    receivedStateEvent = true
    applyState(next)
  })

  void updates
    .getState()
    .then((initial) => {
      if (!receivedStateEvent) applyState(initial)
    })
    .catch(() => {
      // Native API unavailable; stay idle.
    })
}

function applyState(state: DesktopUpdateState): void {
  if (
    snapshot.status === state.status &&
    snapshot.supported === state.supported &&
    snapshot.currentVersion === state.currentVersion &&
    snapshot.version === state.version &&
    snapshot.lastCheckedAt === state.lastCheckedAt &&
    snapshot.downloadProgress === state.downloadProgress
  ) {
    return
  }

  snapshot = state
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The downloaded share of an update in whole percent while it downloads, or
 * null otherwise.
 */
export function updateDownloadPercent(
  state: DesktopUpdateState,
): number | null {
  if (state.status !== "downloading") return null
  const progress = state.downloadProgress
  if (progress === null || !Number.isFinite(progress)) return null
  return Math.round(Math.min(Math.max(progress, 0), 1) * 100)
}

/**
 * Auto-update state of the desktop shell hosting this page. Always "idle" in
 * a regular browser, so update UI renders nothing outside the desktop app.
 */
export function useDesktopUpdateState(): DesktopUpdateState {
  return useSyncExternalStore(
    subscribe,
    () => (alloyDesktop() ? snapshot : IDLE_STATE),
    () => IDLE_STATE,
  )
}
