import { cn } from "@alloy/ui/lib/utils"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import type { Ref } from "react"

/**
 * Vertical scroller whose scrollbar floats over the content, so content keeps
 * its full width even where native scrollbars take a gutter (Windows, Linux).
 * The scrollbar shows while the area is hovered or scrolling. Padding belongs
 * on the viewport, the element that scrolls, which `viewportRef` reaches too.
 */
export function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn(
          "focus-visible:ring-ring min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar className="flex w-2.5 justify-center p-0.5 opacity-0 transition-opacity delay-300 data-hovering:opacity-100 data-hovering:delay-0 data-scrolling:opacity-100 data-scrolling:delay-0">
        <ScrollAreaPrimitive.Thumb className="bg-border-strong hover:bg-border-emphasis w-full rounded-full transition-colors" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}
