import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { cn } from "@alloy/ui/lib/utils"
import type { ReactElement } from "react"

export function DisabledUploadTooltip({
  reason,
  className,
  children,
}: {
  reason: string | null
  className?: string
  children: ReactElement
}) {
  if (!reason) return children

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-disabled="true"
            className={cn(
              "inline-flex focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
