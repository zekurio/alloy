import { t } from "@alloy/i18n"
import { Checkbox } from "@alloy/ui/components/checkbox"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { useEffect, useState } from "react"

import type { RecordingLibraryItem } from "@/lib/desktop"

export function DeleteServerBackedDialog({
  open,
  onOpenChange,
  pending,
  title,
  noun,
  localItem,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  title: string
  noun: "clip" | "recording"
  localItem: RecordingLibraryItem | null
  onConfirm: (deleteLocal: boolean) => void
}) {
  const [deleteLocal, setDeleteLocal] = useState(Boolean(localItem))

  useEffect(() => {
    if (open) setDeleteLocal(Boolean(localItem))
  }, [localItem, open])

  const deleteTitle =
    noun === "clip"
      ? t("Delete this clip?")
      : t("Delete this {noun}?", { noun })
  const deleteAction =
    noun === "clip" ? t("Delete clip") : t("Delete {noun}", { noun })

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={deleteTitle}
      description={t(
        '"{title}" will be removed from the server. This can\'t be undone.',
        { title },
      )}
      confirmLabel={deleteAction}
      pendingLabel={t("Deleting...")}
      pending={pending}
      onConfirm={() => onConfirm(deleteLocal)}
    >
      {localItem ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={deleteLocal}
            onCheckedChange={(checked) => setDeleteLocal(checked === true)}
            disabled={pending}
          />
          <span className="text-foreground-muted">
            {t("Also delete the local copy on this device")}
          </span>
        </label>
      ) : null}
    </ConfirmDeleteDialog>
  )
}
