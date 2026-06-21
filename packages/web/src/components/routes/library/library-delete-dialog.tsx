import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Checkbox } from "@alloy/ui/components/checkbox"
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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("Delete this {noun}?", { noun })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              '"{title}" will be removed from the server. This can\'t be undone.',
              { title },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => onConfirm(deleteLocal)}
            disabled={pending}
          >
            {pending ? t("Deleting...") : t("Delete {noun}", { noun })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
