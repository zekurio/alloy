import type { QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { api } from "./api"
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "./browser-storage"
import { clientLogger } from "./client-log"
import { clipEncodingActive } from "./clip-encoding"
import { clipKeys } from "./clip-query-keys"
import { errorMessage } from "./error-message"
import { searchString } from "./route-search"

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
  if (ids.size === 0) return clearDismissed()
  writeLocalStorageItem(DISMISSED_KEY, JSON.stringify([...ids]))
}

export function useDismissedClips(serverQueue: QueueClip[]) {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())
  const attemptedMigration = useRef(new Set<string>())

  const { mutate: dismiss } = useMutation({
    mutationFn: (id: string) => api.clips.dismissQueue(id),
    onSuccess: (persisted, id) => {
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (rows) =>
        rows?.filter(
          (row) =>
            row.id !== id ||
            row.status === "pending" ||
            row.status === "processing" ||
            clipEncodingActive(row),
        ),
      )
      setDismissed((prev) => {
        const next = new Set(prev)
        if (persisted) next.delete(id)
        else next.add(id)
        saveDismissed(next)
        return next
      })
    },
    onError: (cause) => {
      toast.error(errorMessage(cause, t("Couldn't remove from queue")))
    },
  })

  // Import old local dismissals only for clips in this account's queue.
  // Keep absent IDs for later snapshots and for older contract-1 servers.
  useEffect(() => {
    for (const row of serverQueue) {
      if (!dismissed.has(row.id) || attemptedMigration.current.has(row.id))
        continue
      attemptedMigration.current.add(row.id)
      dismiss(row.id)
    }
  }, [serverQueue, dismissed, dismiss])

  return { dismissed, dismiss }
}
