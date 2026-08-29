"use client"

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
import { CircleAlertIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

interface ConfirmActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  confirmLabel: ReactNode
  pendingLabel: ReactNode
  pending: boolean
  error?: ReactNode
  onConfirm: () => void
  children?: ReactNode
  confirmVariant?: ComponentProps<typeof AlertDialogAction>["variant"]
}

function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  children,
  confirmVariant,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error ? (
          <p
            role="alert"
            className="text-destructive flex items-start gap-2 text-sm"
          >
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            disabled={pending}
          >
            {pending ? pendingLabel : error ? t("Try again") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConfirmActionDialog }
export type { ConfirmActionDialogProps }
