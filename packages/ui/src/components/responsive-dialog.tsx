"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Drawer as DrawerPrimitive } from "vaul"

import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerTitle,
  DrawerTrigger,
} from "@workspace/ui/components/drawer"
import { cn } from "@workspace/ui/lib/utils"

const ResponsiveDialogContext = React.createContext(false)

function useIsResponsiveMobile() {
  return React.useContext(ResponsiveDialogContext)
}

function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  )
}

function ResponsiveDialogContent({
  className,
  children,
  variant = "default",
}: {
  className?: string
  children: React.ReactNode
  variant?: "default" | "secondary"
}) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerContent
        className={cn(
          "max-h-[85vh] bg-surface",
          "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
          className
        )}
      >
        {children}
      </DrawerContent>
    )
  }

  return (
    <DialogContent variant={variant} className={className}>
      {children}
    </DialogContent>
  )
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-header"
        className={cn("flex flex-col gap-0.5 px-4 pt-2 pb-4", className)}
        {...props}
      />
    )
  }

  return <DialogHeader className={className} {...props} />
}

function ResponsiveDialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-body"
        className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)}
        {...props}
      />
    )
  }

  return <DialogBody className={className} {...props} />
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerFooter
        className={cn(
          "flex-row justify-end gap-2 [&>button]:flex-1",
          className
        )}
        {...props}
      />
    )
  }

  return <DialogFooter className={className} {...props} />
}

function ResponsiveDialogTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h2">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerTitle
        className={cn(
          "text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </DrawerTitle>
    )
  }

  return (
    <DialogTitle className={className} {...props}>
      {children}
    </DialogTitle>
  )
}

function ResponsiveDialogDescription({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  const isMobile = useIsResponsiveMobile()

  // On mobile drawers we suppress the description to keep
  // the header clean (title-only, left-aligned).
  if (isMobile) {
    return (
      <DrawerDescription className="sr-only" {...props}>
        {children}
      </DrawerDescription>
    )
  }

  return (
    <DialogDescription className={className} {...props}>
      {children}
    </DialogDescription>
  )
}

type ResponsiveDialogTriggerProps = DialogPrimitive.Trigger.Props &
  React.ComponentProps<typeof DrawerPrimitive.Trigger>

function ResponsiveDialogTrigger(props: ResponsiveDialogTriggerProps) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return <DrawerTrigger {...props} />
  }

  return <DialogTrigger {...props} />
}

type ResponsiveDialogCloseProps = DialogPrimitive.Close.Props &
  React.ComponentProps<typeof DrawerPrimitive.Close>

function ResponsiveDialogClose(props: ResponsiveDialogCloseProps) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return <DrawerClose {...props} />
  }

  return <DialogClose {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
}
