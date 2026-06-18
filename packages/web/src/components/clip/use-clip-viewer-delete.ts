import type { ClipRow } from "@alloy/api"
import type { RecordingEvent } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import * as React from "react"

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
  const [open, setOpen] = React.useState(false)
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const confirm = React.useCallback(
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
              toast.success(tx("Clip deleted"))
            }
            setOpen(false)
            onDeleted?.()
          },
          onError: () => toast.error(tx("Couldn't delete clip")),
        },
      )
    },
    [deleteMutation, localItem, onDeleted, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: React.useCallback(() => setOpen(true), []),
    pending,
    localItem,
    confirm,
  }
}

function useLocalClipLibraryItem(clipId: string): RecordingLibraryItem | null {
  const [localItem, setLocalItem] = React.useState<RecordingLibraryItem | null>(
    null,
  )

  React.useEffect(() => {
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
