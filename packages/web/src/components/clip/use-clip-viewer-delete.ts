import type { ClipRow } from "@alloy/api"
import type { RecordingEvent } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useEffect, useState } from "react"

import { clientLogger } from "@/lib/client-log"
import { useDeleteClipMutation } from "@/lib/clip-queries"
import {
  alloyDesktop,
  onLibraryCapturesChanged,
  type RecordingLibraryItem,
} from "@/lib/desktop"

import { finishLocalClipDelete } from "../routes/library/library-local-actions"

export function useClipViewerDelete({
  row,
  onDeleted,
}: {
  row: ClipRow
  onDeleted?: () => void
}) {
  const localItem = useLocalClipLibraryItem(row.id)
  const deleteMutation = useDeleteClipMutation()
  const [open, setOpen] = useState(false)
  const [deletingLocal, setDeletingLocal] = useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const confirm = useCallback(
    (deleteLocal: boolean) => {
      deleteMutation.mutate(
        { clipId: row.id },
        {
          onSuccess: async () => {
            if (localItem) {
              await finishLocalClipDelete({
                deleteLocal,
                localItem,
                serverId: row.id,
                setDeletingLocal,
              })
            } else {
              toast.success(t("Clip deleted"))
            }
            setOpen(false)
            onDeleted?.()
          },
          onError: () => toast.error(t("Couldn't delete clip")),
        },
      )
    },
    [deleteMutation, localItem, onDeleted, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: useCallback(() => setOpen(true), []),
    pending,
    localItem,
    confirm,
  }
}

function useLocalClipLibraryItem(clipId: string): RecordingLibraryItem | null {
  const [localItem, setLocalItem] = useState<RecordingLibraryItem | null>(null)

  useEffect(() => {
    const desktop = alloyDesktop()
    if (!desktop) {
      setLocalItem(null)
      return
    }

    let active = true
    const refresh = async () => {
      try {
        const snapshot = await desktop.recording.getLibrary()
        if (!active) return
        setLocalItem(
          snapshot.items.find((item) => item.uploadedClipId === clipId) ?? null,
        )
      } catch (cause) {
        clientLogger.warn(
          `[clip-viewer] Failed to scan local library for clip ${clipId}.`,
          cause,
        )
      }
    }

    void refresh()
    const offLibrary = onLibraryCapturesChanged(() => {
      void refresh()
    })
    const offRecording = desktop.recording.onEvent((event) => {
      if (localLibraryEventMayChangeClipLinks(event)) void refresh()
    })

    return () => {
      active = false
      offLibrary()
      offRecording()
    }
  }, [clipId])

  return localItem
}

function localLibraryEventMayChangeClipLinks(event: RecordingEvent): boolean {
  return (
    event.type === "capture-ready" ||
    event.type === "settings" ||
    event.type === "library-download"
  )
}
