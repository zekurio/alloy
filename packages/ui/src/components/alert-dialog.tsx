"use client"

import { Button } from "@alloy/ui/components/button"
import { DialogOverlay } from "@alloy/ui/components/dialog"
import { DIALOG_MOTION_CLASS_NAME } from "@alloy/ui/lib/motion"
import { cn } from "@alloy/ui/lib/utils"
import { AlertDialog } from "@base-ui/react/alert-dialog"
import type { ComponentProps } from "react"

function AlertDialogRoot(props: AlertDialog.Root.Props) {
  return <AlertDialog.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: AlertDialog.Trigger.Props) {
  return <AlertDialog.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(props: AlertDialog.Portal.Props) {
  return <AlertDialog.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialog.Popup.Props & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <DialogOverlay />
      <AlertDialog.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border/80 bg-popover p-4 text-popover-foreground shadow-[0_24px_80px_-16px_rgba(0,0,0,0.8)] outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          DIALOG_MOTION_CLASS_NAME,
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center group-data-[size=default]/alert-dialog-content:place-items-start group-data-[size=default]/alert-dialog-content:text-left",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialog.Title>) {
  return (
    <AlertDialog.Title
      data-slot="alert-dialog-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialog.Description>) {
  return (
    <AlertDialog.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogAction(props: ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" {...props} />
}

function AlertDialogCancel({
  variant = "outline",
  size = "default",
  ...props
}: AlertDialog.Close.Props &
  Pick<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialog.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialogRoot as AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
