import type { DesktopUpdateState } from "@alloy/contracts"
import { useSyncExternalStore } from "react"

import { alloyDesktop } from "@/lib/desktop"

const IDLE_STATE: DesktopUpdateState = {
  status: "idle",
  currentVersion: null,
  version: null,
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
  const updates = alloyDesktop()?.updates
  if (!updates) return

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
      // Bridge unavailable; stay idle.
    })
}

function applyState(state: DesktopUpdateState): void {
  if (
    snapshot.status === state.status &&
    snapshot.currentVersion === state.currentVersion &&
    snapshot.version === state.version
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
 * Auto-update state of the desktop shell hosting this page. Always "idle" in
 * a regular browser or on desktop shells that predate the updates bridge, so
 * update UI renders nothing outside the desktop app.
 */
export function useDesktopUpdateState(): DesktopUpdateState {
  return useSyncExternalStore(
    subscribe,
    () => (alloyDesktop()?.updates ? snapshot : IDLE_STATE),
    () => IDLE_STATE,
  )
}
