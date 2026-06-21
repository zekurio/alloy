import {
  isDesktopUpdateChannel,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
} from "@alloy/contracts"
import { useSyncExternalStore } from "react"

import { alloyDesktop } from "@/lib/desktop"

const IDLE_STATE: DesktopUpdateState = { status: "idle", version: null }

interface DesktopUpdatesSnapshot {
  state: DesktopUpdateState
  channel: DesktopUpdateChannel | null
  channelHydrated: boolean
}

const EMPTY_SNAPSHOT: DesktopUpdatesSnapshot = {
  state: IDLE_STATE,
  channel: null,
  channelHydrated: true,
}
let snapshot: DesktopUpdatesSnapshot = {
  state: IDLE_STATE,
  channel: null,
  channelHydrated: false,
}
const listeners = new Set<() => void>()
let started = false

/**
 * Shared renderer-side view of desktop updater state. The nav/footer update UI
 * warms this cache, so Settings > Updates can reuse the already-known channel
 * instead of flashing through a local null state.
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

  if (!updates.getChannel) {
    markChannelHydrated()
    return
  }
  void updates
    .getChannel()
    .then((channel) => {
      applyChannel(channel)
    })
    .catch(() => {
      // Older or unhealthy bridges can still show update status.
      markChannelHydrated()
    })
}

function applyState(state: DesktopUpdateState): void {
  if (
    snapshot.state.status === state.status &&
    snapshot.state.version === state.version
  ) {
    return
  }

  snapshot = { ...snapshot, state }
  emit()
}

function applyChannel(value: unknown): void {
  if (!isDesktopUpdateChannel(value)) {
    markChannelHydrated()
    return
  }
  if (snapshot.channel === value && snapshot.channelHydrated) return
  snapshot = { ...snapshot, channel: value, channelHydrated: true }
  emit()
}

function markChannelHydrated(): void {
  if (snapshot.channelHydrated) return
  snapshot = { ...snapshot, channelHydrated: true }
  emit()
}

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function currentSnapshot(): DesktopUpdatesSnapshot {
  return alloyDesktop()?.updates ? snapshot : EMPTY_SNAPSHOT
}

/**
 * Auto-update state of the desktop shell hosting this page. Always "idle" in
 * a regular browser or on desktop shells that predate the updates bridge, so
 * update UI renders nothing outside the desktop app.
 */
export function useDesktopUpdateState(): DesktopUpdateState {
  return useSyncExternalStore(
    subscribe,
    () => currentSnapshot().state,
    () => IDLE_STATE,
  )
}

export function useDesktopUpdateChannel(): DesktopUpdateChannel | null {
  return useSyncExternalStore(
    subscribe,
    () => currentSnapshot().channel,
    () => null,
  )
}

export function useDesktopUpdateChannelLoading(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !currentSnapshot().channelHydrated,
    () => false,
  )
}

export function rememberDesktopUpdateChannel(
  channel: DesktopUpdateChannel,
): void {
  applyChannel(channel)
}
