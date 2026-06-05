import { DrawerHandle } from "@workspace/ui/components/drawer"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

export const mobileDrawerContentClass =
  "max-h-[92dvh] border-t-white/[0.08] bg-surface text-foreground"

export function MobileDrawerHandle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <DrawerHandle
      className={cn(
        "mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20",
        className,
      )}
      {...props}
    />
  )
}
