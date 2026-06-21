"use client"

import { cn } from "@alloy/ui/lib/utils"
import { Drawer } from "@base-ui/react/drawer"
import { createContext, isValidElement, useContext } from "react"
import type { ComponentProps } from "react"

type DrawerSide = "top" | "right" | "bottom" | "left"
type DrawerSlotProps = ComponentProps<"div"> & {
  slot: string
  baseClassName: string
}

function swipeDirectionForSide(side: DrawerSide) {
  switch (side) {
    case "top":
      return "up"
    case "right":
      return "right"
    case "left":
      return "left"
    case "bottom":
      return "down"
  }
}

const DrawerDirectionContext = createContext<DrawerSide>("bottom")

function DrawerRoot({
  direction = "bottom",
  handleOnly: _handleOnly,
  ...props
}: Drawer.Root.Props & {
  direction?: DrawerSide
  /**
   * Kept for legacy API compatibility. Base UI drawers always allow swiping
   * from the popup surface; callers can still render DrawerHandle for a visible
   * grip.
   */
  handleOnly?: boolean
}) {
  return (
    <DrawerDirectionContext.Provider value={direction}>
      <Drawer.Root
        data-slot="drawer"
        swipeDirection={swipeDirectionForSide(direction)}
        {...props}
      />
    </DrawerDirectionContext.Provider>
  )
}

function DrawerTrigger({
  asChild,
  children,
  ...props
}: Drawer.Trigger.Props & { asChild?: boolean }) {
  return (
    <Drawer.Trigger
      data-slot="drawer-trigger"
      render={asChild && isValidElement(children) ? children : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </Drawer.Trigger>
  )
}

function DrawerPortal({ ...props }: Drawer.Portal.Props) {
  return <Drawer.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  asChild,
  children,
  ...props
}: Drawer.Close.Props & { asChild?: boolean }) {
  return (
    <Drawer.Close
      data-slot="drawer-close"
      render={asChild && isValidElement(children) ? children : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </Drawer.Close>
  )
}

function DrawerSlot({
  slot,
  baseClassName,
  className,
  ...props
}: DrawerSlotProps) {
  return (
    <div data-slot={slot} className={cn(baseClassName, className)} {...props} />
  )
}

function DrawerHandle({ className, ...props }: ComponentProps<"div">) {
  return (
    <DrawerSlot
      slot="drawer-handle"
      baseClassName="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20"
      className={className}
      {...props}
    />
  )
}

function DrawerOverlay({
  className,
  // Base UI suppresses the backdrop when the drawer is nested inside another
  // dialog/drawer (`enabled: forceRender || !nested`). Force it so the sheet
  // always darkens its surroundings and the backdrop can catch outside taps.
  forceRender = true,
  ...props
}: Drawer.Backdrop.Props) {
  return (
    <Drawer.Backdrop
      data-slot="drawer-overlay"
      forceRender={forceRender}
      className={cn(
        "fixed inset-0 z-50 bg-[oklch(12%_0.01_250)]/50",
        className,
      )}
      {...props}
    />
  )
}

function DrawerViewport({ className, ...props }: Drawer.Viewport.Props) {
  return (
    <Drawer.Viewport
      data-slot="drawer-viewport"
      className={cn("fixed inset-0 z-50 pointer-events-none", className)}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  container,
  ...props
}: Drawer.Popup.Props & {
  /** Portal target — defaults to document.body. Pass the player container so
   *  the sheet renders above an element that is currently fullscreen. */
  container?: HTMLElement | null
}) {
  const direction = useContext(DrawerDirectionContext)

  return (
    <DrawerPortal container={container ?? undefined}>
      <DrawerOverlay />
      <DrawerViewport>
        <Drawer.Popup
          data-slot="drawer-content"
          data-side={direction}
          className={cn(
            "group/drawer-content pointer-events-auto fixed z-50 flex h-auto flex-col overflow-hidden bg-background will-change-transform data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:mt-24 data-[side=bottom]:max-h-[92dvh] data-[side=bottom]:rounded-t-lg data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:mb-24 data-[side=top]:max-h-[92dvh] data-[side=top]:rounded-b-lg data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
            className,
          )}
          {...props}
        >
          {children}
        </Drawer.Popup>
      </DrawerViewport>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <DrawerSlot
      slot="drawer-header"
      baseClassName="grid gap-1.5 p-4 text-center sm:text-left"
      className={className}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <DrawerSlot
      slot="drawer-footer"
      baseClassName="mt-auto flex flex-col gap-2 p-4 [&_[data-slot=button][data-variant=outline]]:!border-transparent [&_[data-slot=button][data-variant=outline]]:!bg-transparent [&_[data-slot=button][data-variant=outline]]:!text-foreground-muted [&_[data-slot=button][data-variant=outline]]:hover:!bg-surface-raised [&_[data-slot=button][data-variant=outline]]:hover:!text-foreground [&_[data-slot=button][data-variant=secondary]]:!border-transparent [&_[data-slot=button][data-variant=secondary]]:!bg-transparent [&_[data-slot=button][data-variant=secondary]]:!text-foreground-muted [&_[data-slot=button][data-variant=secondary]]:hover:!bg-surface-raised [&_[data-slot=button][data-variant=secondary]]:hover:!text-foreground"
      className={className}
      {...props}
    />
  )
}

function DrawerTitle({ className, ...props }: Drawer.Title.Props) {
  return (
    <Drawer.Title
      data-slot="drawer-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({ className, ...props }: Drawer.Description.Props) {
  return (
    <Drawer.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  DrawerRoot as Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
}
