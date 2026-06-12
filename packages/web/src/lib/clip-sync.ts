import * as React from "react"

import { clientLogger } from "@/lib/client-log"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type RecordingLibrarySyncSnapshot,
} from "@/lib/desktop"

/**
 * Shared renderer-side view of the desktop shell's upload sync queue (local
 * captures heading to the server after a game ends). The shell owns the
 * state; this module hydrates once from `getSync` and then follows
 * "library-sync" recording events, so the sync popover and library cards see
 * the same progress.
 */

const EMPTY_SNAPSHOT: RecordingLibrarySyncSnapshot = {
  paused: false,
  blockedReason: null,
  items: [],
}

let snapshot: RecordingLibrarySyncSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
let started = false

/** True when the desktop shell is new enough to run the sync queue. */
export function clipSyncSupported(): boolean {
  const desktop = alloyDesktop()
  return typeof desktop?.recording.getSync === "function"
}

function applySnapshot(next: RecordingLibrarySyncSnapshot): void {
  const hadIncomplete = snapshot.items.some(
    (item) => item.status !== "completed",
  )
  snapshot = next
  // A drained queue means captures gained uploadedClipId links — re-scan.
  if (
    hadIncomplete &&
    next.items.every((item) => item.status === "completed")
  ) {
    notifyLibraryCapturesChanged()
  }
  for (const listener of listeners) listener()
}

function ensureStarted(): void {
  if (started) return
  started = true
  const desktop = alloyDesktop()
  if (!desktop || !clipSyncSupported()) return

  desktop.recording.onEvent((event) => {
    if (event.type === "library-sync") applySnapshot(event.sync)
  })
  void desktop.recording
    .getSync?.()
    .then((current) => {
      // Events that raced ahead of the hydration snapshot are fresher.
      if (snapshot === EMPTY_SNAPSHOT) applySnapshot(current)
    })
    .catch((cause) => {
      clientLogger.warn("[sync] Failed to load sync queue snapshot.", cause)
    })
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Live snapshot of the desktop sync queue (empty outside the desktop app). */
export function useClipSync(): RecordingLibrarySyncSnapshot {
  return React.useSyncExternalStore(subscribe, () => snapshot)
}

export function pauseClipSync(): void {
  void alloyDesktop()
    ?.recording.pauseSync?.()
    .then(applySnapshot)
    .catch((cause) => {
      clientLogger.warn("[sync] Failed to pause sync.", cause)
    })
}

export function resumeClipSync(): void {
  void alloyDesktop()
    ?.recording.resumeSync?.()
    .then(applySnapshot)
    .catch((cause) => {
      clientLogger.warn("[sync] Failed to resume sync.", cause)
    })
}

export function cancelClipSyncItem(captureId: string): void {
  void alloyDesktop()
    ?.recording.cancelSyncItem?.(captureId)
    .catch((cause) => {
      clientLogger.warn(`[sync] Failed to cancel sync of ${captureId}.`, cause)
    })
}

export function retryClipSyncItem(captureId: string): void {
  void alloyDesktop()
    ?.recording.retrySyncItem?.(captureId)
    .catch((cause) => {
      clientLogger.warn(`[sync] Failed to retry sync of ${captureId}.`, cause)
    })
}

/** Manually queues a local capture for upload ("Sync now"). */
export async function queueClipSyncItem(captureId: string): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop || !clipSyncSupported()) {
    throw new Error("Clip sync needs the Alloy desktop app.")
  }
  ensureStarted()
  await desktop.recording.queueSyncItem?.(captureId)
}
