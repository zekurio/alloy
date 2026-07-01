import { cn } from "@alloy/ui/lib/utils"

const fieldControlTransitionClassName =
  "transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]"

const fieldControlClassName = cn(
  "rounded-lg border border-border bg-input text-foreground outline-none",
  fieldControlTransitionClassName,
  "hover:border-border-strong hover:bg-surface-raised",
  "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/15 aria-invalid:ring-inset",
  "user-invalid:border-destructive user-invalid:bg-destructive/5 user-invalid:ring-2 user-invalid:ring-destructive/15 user-invalid:ring-inset",
)

export { fieldControlClassName, fieldControlTransitionClassName }
