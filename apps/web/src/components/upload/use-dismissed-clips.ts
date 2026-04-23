import * as React from "react"

import type { QueueClip } from "@workspace/api"

const DISMISSED_KEY = "alloy:queue-dismissed"

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v) => typeof v === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
  } catch {
    // Quota/private mode — dismissals just won't persist across reloads.
  }
}

export function useDismissedClips(serverQueue: QueueClip[]) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(() =>
    loadDismissed()
  )

  // Prune IDs the server no longer returns so localStorage stays bounded.
  React.useEffect(() => {
    if (dismissed.size === 0 || serverQueue.length === 0) return
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
  }, [serverQueue, dismissed])

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
      for (const id of ids) next.add(id)
      saveDismissed(next)
      return next
    })
  }, [])

  return { dismissed, dismiss, dismissMany }
}
