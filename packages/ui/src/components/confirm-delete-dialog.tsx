"use client"

import {
  ConfirmActionDialog,
  type ConfirmActionDialogProps,
} from "@alloy/ui/components/confirm-action-dialog"

type ConfirmDeleteDialogProps = Omit<ConfirmActionDialogProps, "confirmVariant">

function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps) {
  return <ConfirmActionDialog {...props} confirmVariant="destructive" />
}

export { ConfirmDeleteDialog }
