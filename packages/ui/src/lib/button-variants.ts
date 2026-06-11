import { cn } from "@alloy/ui/lib/utils"
import { cva } from "class-variance-authority"

const buttonVariants = cva(
  cn(
    "group/button inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-md border border-transparent whitespace-nowrap select-none",
    "font-semibold tracking-[-0.005em]",
    "transition-[background,border-color,color,box-shadow]",
    "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ),
  {
    variants: {
      variant: {
        primary:
          "border-accent bg-accent text-accent-foreground hover:border-accent-hover hover:bg-accent-hover active:bg-accent-active",
        secondary:
          "border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-neutral-150",
        outline:
          "border-border-strong bg-transparent text-foreground hover:border-accent-border hover:text-accent",
        ghost:
          "bg-transparent text-foreground-muted hover:bg-surface-raised hover:text-foreground",
        "accent-outline":
          "border-accent-border bg-accent-soft text-accent hover:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)]",
        // Subtle, outline-style destructive — for triggers that open a confirm
        // step (e.g. settings danger zone) where a solid fill would be too loud.
        danger:
          "border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-transparent text-danger hover:bg-[color-mix(in_oklab,var(--danger)_14%,transparent)]",
        link: "border-transparent text-accent underline-offset-4 hover:underline",
        // shadcn aliases
        default:
          "border-accent bg-accent text-accent-foreground hover:border-accent-hover hover:bg-accent-hover active:bg-accent-active",
        // Solid destructive — the emphasized confirm action in alert dialogs.
        destructive:
          "border-danger bg-danger text-white hover:border-[color-mix(in_oklab,var(--danger)_85%,black)] hover:bg-[color-mix(in_oklab,var(--danger)_85%,black)] active:bg-[color-mix(in_oklab,var(--danger)_78%,black)]",
      },
      size: {
        default: "h-9 px-4 text-sm leading-4 sm:h-8",
        sm: "h-7 px-3.5 text-xs leading-4",
        md: "h-9 px-4 text-sm leading-4 sm:h-8",
        lg: "h-10 px-5 text-md leading-5 sm:h-9",
        icon: "size-8 px-0",
        "icon-xs": "size-5 px-0",
        "icon-sm": "size-6 px-0",
        "icon-lg": "size-9 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
)

export { buttonVariants }
