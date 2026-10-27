import { t } from "@alloy/i18n"
import { Checkbox } from "@alloy/ui/components/checkbox"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { useState } from "react"

import type { RecordingLibraryItem } from "@/lib/desktop"

export function DeleteServerBackedDialog({
  open,
  onOpenChange,
  pending,
  error,
  title,
  localItem,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error?: string | null
  title: string
  /**
   * Every caller deletes a clip. Kept optional until the callers in
   * components/clip stop passing it.
   */
  noun?: "clip"
  localItem: RecordingLibraryItem | null
  onConfirm: (deleteLocal: boolean) => void
}) {
  // The user's pick for this opening of the dialog; each opening starts over
  // from the default. Unpicked, it follows whether a local copy exists, so a
  // library refresh while open never re-ticks a checkbox the user cleared.
  const [choice, setChoice] = useState<{
    open: boolean
    deleteLocal: boolean | null
  }>({ open, deleteLocal: null })
  if (choice.open !== open) {
    setChoice({ open, deleteLocal: open ? null : choice.deleteLocal })
  }
  const deleteLocal = choice.deleteLocal ?? localItem !== null

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Delete this clip?")}
      description={t(
        '"{title}" will be removed from the server. This can\'t be undone.',
        { title },
      )}
      confirmLabel={t("Delete clip")}
      pendingLabel={t("Deleting...")}
      pending={pending}
      error={error}
      onConfirm={() => onConfirm(deleteLocal)}
    >
      {localItem ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={deleteLocal}
            onCheckedChange={(checked) =>
              setChoice({ open, deleteLocal: checked === true })
            }
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
