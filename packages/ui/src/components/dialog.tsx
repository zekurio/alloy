import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@workspace/ui/lib/utils"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/70",
        "supports-backdrop-filter:backdrop-blur-[4px]",
        "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
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
}: DialogPrimitive.Popup.Props & {
  showOverlay?: boolean
  disableZoom?: boolean
  centered?: boolean
  variant?: "default" | "secondary"
}) {
  return (
    <DialogPortal>
      {showOverlay ? <DialogOverlay /> : null}
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-variant={variant}
        className={cn(
          "group/dialog-content fixed z-50 overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-lg",
          "data-[variant=secondary]:rounded-xl data-[variant=secondary]:border-border/80 data-[variant=secondary]:shadow-[0_28px_90px_-38px_rgba(0,0,0,0.82)]",
          "duration-100 outline-none",
          centered &&
            "top-1/2 left-1/2 w-full max-w-[440px] -translate-x-1/2 -translate-y-1/2",
          disableZoom
            ? "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            : "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DialogPortal>
  )
}

function DialogViewportContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      disableZoom
      className={cn(
        "h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-none overflow-hidden rounded-[28px] p-0",
        "lg:h-[calc(100vh-48px)] lg:w-[calc(100vw-200px)]",
        className
      )}
      {...props}
    />
  )
}

function renderDialogSection(
  slot: string,
  defaultClassName: string,
  { className, ...props }: React.ComponentProps<"div">
) {
  return (
    <div
      data-slot={slot}
      className={cn(defaultClassName, className)}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return renderDialogSection(
    "dialog-header",
    "flex flex-col gap-1.5 px-6 pt-5 group-data-[variant=secondary]/dialog-content:px-5 group-data-[variant=secondary]/dialog-content:pt-4 sm:group-data-[variant=secondary]/dialog-content:px-6",
    { className, ...props }
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return renderDialogSection(
    "dialog-body",
    "px-6 py-4 group-data-[variant=secondary]/dialog-content:px-5 sm:group-data-[variant=secondary]/dialog-content:px-6",
    { className, ...props }
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return renderDialogSection(
    "dialog-footer",
    "flex items-center justify-end gap-2 px-6 pb-5 group-data-[variant=secondary]/dialog-content:px-5 group-data-[variant=secondary]/dialog-content:pb-4 sm:group-data-[variant=secondary]/dialog-content:px-6",
    { className, ...props }
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-foreground-dim",
        "[&_a]:text-accent [&_a]:underline-offset-4 hover:[&_a]:underline",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogBody,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewportContent,
}
