import * as React from "react"

import type { QueueClip } from "@workspace/api"
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "@/lib/browser-storage"
import { clientLogger } from "@/lib/client-log"

const DISMISSED_KEY = "alloy:queue-dismissed"

function clearDismissed(): void {
  removeLocalStorageItem(DISMISSED_KEY)
}

function loadDismissed(): Set<string> {
  const raw = readLocalStorageItem(DISMISSED_KEY)
  if (!raw) return new Set()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (cause) {
    clientLogger.warn(
      "[upload-queue] Dismissed clip cache was malformed.",
      cause
    )
    clearDismissed()
    return new Set()
  }

  if (!Array.isArray(parsed)) {
    clearDismissed()
    return new Set()
  }

  const ids = new Set(parsed.filter((v) => typeof v === "string"))
  if (ids.size !== parsed.length) saveDismissed(ids)
  return ids
}

function saveDismissed(ids: Set<string>): void {
  writeLocalStorageItem(DISMISSED_KEY, JSON.stringify([...ids]))
}

export function useDismissedClips(
  serverQueue: QueueClip[],
  serverQueueHydrated: boolean
) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(() =>
    loadDismissed()
  )

  React.useEffect(() => {
    if (!serverQueueHydrated || dismissed.size === 0) return
    const live = new Set(serverQueue.map((r) => r.id))
    let changed = false
    const next = new Set<string>()
    for (const id of dismissed) {
      if (live.has(id)) next.add(id)
      else changed = true
    }
    if (changed) {
      setDismissed(next)
      saveDismissed(next)
    }
  }, [serverQueue, serverQueueHydrated, dismissed])

  const dismiss = React.useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveDismissed(next)
      return next
    })
  }, [])

  const dismissMany = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setDismissed((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of ids) {
        if (next.has(id)) continue
        next.add(id)
        changed = true
      }
      if (!changed) return prev
      saveDismissed(next)
      return next
    })
  }, [])

  return { dismissed, dismiss, dismissMany }
}
