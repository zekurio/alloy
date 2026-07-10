import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

const calloutVariants = cva(
  "flex items-start gap-2 rounded-md border p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-raised/40 text-foreground-muted",
        info: "border-info/30 bg-info/5 text-foreground",
        warning: "border-warning/30 bg-warning/5 text-warning",
        destructive: "border-destructive/40 bg-destructive/5 text-destructive",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
)

/**
 * Inline notice box for errors, warnings, and hints. Pass a lucide icon as
 * the first child for a leading glyph. Destructive/warning tones announce
 * as `role="alert"` unless a role is passed explicitly.
 */
function Callout({
  className,
  tone = "neutral",
  role,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  const impliedRole =
    tone === "destructive" || tone === "warning" ? "alert" : undefined
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      role={role ?? impliedRole}
      className={cn(calloutVariants({ tone, className }))}
      {...props}
    />
  )
}

export { Callout, calloutVariants }
