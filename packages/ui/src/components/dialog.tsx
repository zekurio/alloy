import {
  MODAL_FOOTER_BUTTON_CLASS_NAME,
  MODAL_OVERLAY_CLASS_NAME,
  MODAL_OVERLAY_FORCE_RENDER,
} from "@alloy/ui/lib/modal"
import { DIALOG_MOTION_CLASS_NAME } from "@alloy/ui/lib/motion"
import { cn } from "@alloy/ui/lib/utils"
import { Dialog } from "@base-ui/react/dialog"
import type { ComponentProps } from "react"

function DialogRoot(props: Dialog.Root.Props) {
  return <Dialog.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: Dialog.Trigger.Props) {
  return <Dialog.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: Dialog.Portal.Props) {
  return <Dialog.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: Dialog.Close.Props) {
  return <Dialog.Close data-slot="dialog-close" {...props} />
}

/** Also used by AlertDialog, whose Backdrop part is Base UI's Dialog.Backdrop. */
function DialogOverlay({
  className,
  forceRender = MODAL_OVERLAY_FORCE_RENDER,
  ...props
}: Dialog.Backdrop.Props) {
  return (
    <Dialog.Backdrop
      data-slot="dialog-overlay"
      forceRender={forceRender}
      className={cn(
        "fixed inset-0 isolate z-50",
        MODAL_OVERLAY_CLASS_NAME,
        DIALOG_MOTION_CLASS_NAME,
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  showOverlay = true,
  disableZoom = false,
  centered = true,
  variant = "default",
  ...props
}: Dialog.Popup.Props & {
  showOverlay?: boolean
  disableZoom?: boolean
  centered?: boolean
  variant?: "default" | "secondary"
}) {
  return (
    <DialogPortal>
      {showOverlay ? <DialogOverlay /> : null}
      <Dialog.Popup
        data-slot="dialog-content"
        data-variant={variant}
        className={cn(
          "group/dialog-content fixed z-50 overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-lg",
          "data-[variant=secondary]:rounded-xl data-[variant=secondary]:border-border/80 data-[variant=secondary]:shadow-[0_28px_90px_-38px_rgba(0,0,0,0.82)]",
          DIALOG_MOTION_CLASS_NAME,
          "outline-none",
          centered &&
            "top-1/2 left-1/2 w-full max-w-[440px] -translate-x-1/2 -translate-y-1/2",
          disableZoom
            ? "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            : "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </DialogPortal>
  )
}

function DialogViewportContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      disableZoom
      className={cn(
        "h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-none overflow-hidden rounded-[28px] p-0",
        "lg:h-[calc(100vh-48px)] lg:w-[calc(100vw-200px)]",
        className,
      )}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-1.5 px-6 pt-5 group-data-[variant=secondary]/dialog-content:px-5 group-data-[variant=secondary]/dialog-content:pt-4 sm:group-data-[variant=secondary]/dialog-content:px-6",
        className,
      )}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "px-6 py-4 group-data-[variant=secondary]/dialog-content:px-5 sm:group-data-[variant=secondary]/dialog-content:px-6",
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex items-center justify-end gap-2 px-6 pb-5 group-data-[variant=secondary]/dialog-content:px-5 group-data-[variant=secondary]/dialog-content:pb-4 sm:group-data-[variant=secondary]/dialog-content:px-6",
        MODAL_FOOTER_BUTTON_CLASS_NAME,
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: Dialog.Title.Props) {
  return (
    <Dialog.Title
      data-slot="dialog-title"
      className={cn(
        "text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: Dialog.Description.Props) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-foreground-dim",
        "[&_a]:text-accent [&_a]:underline-offset-4 hover:[&_a]:underline",
        className,
      )}
      {...props}
    />
  )
}

export {
  DialogRoot as Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
  DialogViewportContent,
}
