import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type { VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  cn(
    "group/button inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-md border border-transparent whitespace-nowrap select-none",
    "font-semibold tracking-[-0.005em]",
    "transition-[background,border-color,color,box-shadow]",
    "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
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
        danger:
          "border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-transparent text-danger hover:bg-[color-mix(in_oklab,var(--danger)_14%,transparent)]",
        link: "border-transparent text-accent underline-offset-4 hover:underline",
        // shadcn aliases
        default:
          "border-accent bg-accent text-accent-foreground hover:border-accent-hover hover:bg-accent-hover active:bg-accent-active",
        destructive:
          "border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-transparent text-danger hover:bg-[color-mix(in_oklab,var(--danger)_14%,transparent)]",
      },
      size: {
        default: "h-8 px-4 text-sm",
        sm: "h-7 px-3.5 text-xs",
        md: "h-8 px-4 text-sm",
        lg: "h-9 px-5 text-md",
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
  }
)

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
