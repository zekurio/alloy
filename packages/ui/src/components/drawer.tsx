import {
  MODAL_FOOTER_BUTTON_CLASS_NAME,
  MODAL_OVERLAY_CLASS_NAME,
  MODAL_OVERLAY_FORCE_RENDER,
} from "@alloy/ui/lib/modal"
import { cn } from "@alloy/ui/lib/utils"
import { Drawer } from "@base-ui/react/drawer"
import { isValidElement } from "react"
import type { ComponentProps } from "react"

/** A sheet that rises from the bottom edge and swipes down to close. */
function DrawerRoot(props: Drawer.Root.Props) {
  return <Drawer.Root data-slot="drawer" swipeDirection="down" {...props} />
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

function DrawerPortal(props: Drawer.Portal.Props) {
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

function DrawerHandle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-handle"
      className={cn(
        "mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20",
        className,
      )}
      {...props}
    />
  )
}

function DrawerOverlay({
  className,
  forceRender = MODAL_OVERLAY_FORCE_RENDER,
  ...props
}: Drawer.Backdrop.Props) {
  return (
    <Drawer.Backdrop
      data-slot="drawer-overlay"
      forceRender={forceRender}
      className={cn("fixed inset-0 z-50", MODAL_OVERLAY_CLASS_NAME, className)}
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
  return (
    <DrawerPortal container={container ?? undefined}>
      <DrawerOverlay />
      <DrawerViewport>
        <Drawer.Popup
          data-slot="drawer-content"
          className={cn(
            "group/drawer-content pointer-events-auto fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[92dvh] flex-col overflow-hidden rounded-t-lg border-t bg-background will-change-transform",
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

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 p-4",
        MODAL_FOOTER_BUTTON_CLASS_NAME,
        className,
      )}
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
  DrawerTitle,
  DrawerTrigger,
}
