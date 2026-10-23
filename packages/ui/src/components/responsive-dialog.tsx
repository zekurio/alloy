"use client"

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
} from "@alloy/ui/components/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cn } from "@alloy/ui/lib/utils"
import { createContext, useContext } from "react"
import type { CSSProperties, ComponentProps, ReactNode } from "react"

const ResponsiveDialogContext = createContext(false)

function useIsResponsiveMobile() {
  return useContext(ResponsiveDialogContext)
}

function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
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
  style,
}: {
  className?: string
  children: ReactNode
  variant?: "default" | "secondary"
  style?: CSSProperties
}) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerContent
        className={cn(
          "max-h-[92dvh] border-t-white/[0.08] bg-surface text-foreground",
          "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
          className,
        )}
        style={style}
      >
        <DrawerHandle />
        {children}
      </DrawerContent>
    )
  }

  return (
    <DialogContent variant={variant} className={className} style={style}>
      {children}
    </DialogContent>
  )
}

function ResponsiveDialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-header"
        className={cn("flex flex-col gap-0.5 px-4 pt-4 pb-4", className)}
        {...props}
      />
    )
  }

  return <DialogHeader className={className} {...props} />
}

function ResponsiveDialogBody({ className, ...props }: ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-body"
        className={cn("min-h-0 flex-1 overflow-y-scroll px-4 py-4", className)}
        {...props}
      />
    )
  }

  return <DialogBody className={className} {...props} />
}

function ResponsiveDialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerFooter
        className={cn(
          "flex-row justify-end gap-2 [&>button]:flex-1",
          className,
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
}: ComponentProps<"h2">) {
  const isMobile = useIsResponsiveMobile()

  if (isMobile) {
    return (
      <DrawerTitle
        className={cn(
          "text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground",
          className,
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
}: ComponentProps<"p">) {
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

function ResponsiveDialogTrigger(
  props: Omit<ComponentProps<typeof DialogTrigger>, "handle">,
) {
  const isMobile = useIsResponsiveMobile()
  return isMobile ? <DrawerTrigger {...props} /> : <DialogTrigger {...props} />
}

function ResponsiveDialogClose(
  props: Omit<ComponentProps<typeof DialogClose>, "handle">,
) {
  const isMobile = useIsResponsiveMobile()
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />
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
