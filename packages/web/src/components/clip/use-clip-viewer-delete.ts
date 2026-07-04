import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useState } from "react"

import { useDeleteClipMutation } from "@/lib/clip-queries"

import { finishLocalClipDelete } from "../routes/library/library-local-actions"
import { useLocalClipPlayback } from "./use-local-clip-playback"

export function useClipViewerDelete({
  row,
  onDeleted,
}: {
  row: ClipRow
  onDeleted?: () => void
}) {
  const localItem = useLocalClipPlayback(row.id).localItem
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
