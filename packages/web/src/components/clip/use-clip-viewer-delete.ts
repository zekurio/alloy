import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useMutation } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { useDeleteClipMutation } from "@/lib/clip-queries"
import { errorMessage } from "@/lib/error-message"

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
  // The local copy is cleaned up once the server delete lands.
  const localDeleteMutation = useMutation({
    mutationFn: finishLocalClipDelete,
    networkMode: "always",
  })
  const [open, setOpen] = useState(false)
  const pending = deleteMutation.isPending || localDeleteMutation.isPending

  const confirm = useCallback(
    (deleteLocal: boolean) => {
      deleteMutation.mutate(
        { clipId: row.id },
        {
          onSuccess: async () => {
            if (localItem) {
              await localDeleteMutation.mutateAsync({
                deleteLocal,
                localItem,
                serverId: row.id,
              })
            }
            setOpen(false)
            onDeleted?.()
          },
        },
      )
    },
    [deleteMutation, localDeleteMutation, localItem, onDeleted, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: useCallback(() => setOpen(true), []),
    pending,
    error: deleteMutation.error
      ? errorMessage(deleteMutation.error, t("Couldn't delete clip"))
      : null,
    localItem,
    confirm,
  }
}
