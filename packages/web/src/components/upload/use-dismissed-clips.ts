import { useCallback, useState } from "react"

import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "@/lib/browser-storage"
import { clientLogger } from "@/lib/client-log"
import { searchString } from "@/lib/route-search"

const DISMISSED_KEY = "alloy:queue-dismissed"

function clearDismissed(): void {
  removeLocalStorageItem(DISMISSED_KEY)
}

function loadDismissed(): Set<string> {
  const raw = readLocalStorageItem(DISMISSED_KEY)
  if (!raw) return new Set()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    clientLogger.warn(
      "[upload-queue] Dismissed clip cache was malformed.",
      cause,
    )
    clearDismissed()
    return new Set()
  }

  if (!Array.isArray(parsed)) {
    clearDismissed()
    return new Set()
  }

  const ids = new Set(parsed.flatMap((value) => searchString(value) ?? []))
  if (ids.size !== parsed.length) saveDismissed(ids)
  return ids
}

function saveDismissed(ids: Set<string>): void {
  writeLocalStorageItem(DISMISSED_KEY, JSON.stringify([...ids]))
}

export function useDismissedClips() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())

  // Queue snapshots contain only the 50 newest clips plus active media work.
  // An absent row is therefore not proof that the clip was deleted. Keep its
  // dismissal so an older clip cannot reappear after reconnecting or while a
  // background re-encode temporarily makes it active again.

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveDismissed(next)
      return next
    })
  }, [])

  const dismissMany = useCallback((ids: string[]) => {
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
