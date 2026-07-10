import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

function EmptySection({
  as: Component = "div",
  className,
  slot,
  ...props
}: ComponentProps<"div"> & {
  as?: "div" | "p"
  slot: string
}) {
  return <Component data-slot={slot} className={cn(className)} {...props} />
}

function renderEmptySection(
  slot: string,
  defaultClassName: string,
  { className, ...props }: ComponentProps<"div">,
) {
  return (
    <EmptySection
      slot={slot}
      className={cn(defaultClassName, className)}
      {...props}
    />
  )
}

function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
        className,
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return renderEmptySection(
    "empty-header",
    "flex max-w-sm flex-col items-center gap-2",
    {
      className,
      ...props,
    },
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex shrink-0 items-center justify-center rounded-lg bg-muted text-foreground",
      },
      size: {
        sm: "",
        md: "",
        lg: "",
      },
    },
    compoundVariants: [
      {
        variant: "icon",
        size: "sm",
        className: "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
      {
        variant: "icon",
        size: "md",
        className: "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
      {
        variant: "icon",
        size: "lg",
        className: "size-12 [&_svg:not([class*='size-'])]:size-6",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
)

function EmptyMedia({
  className,
  variant = "default",
  size = "sm",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, size, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return renderEmptySection(
    "empty-title",
    "font-heading text-sm font-medium tracking-tight",
    {
      className,
      ...props,
    },
  )
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <EmptySection
      as="p"
      slot="empty-description"
      className={cn(
        "text-sm/relaxed text-foreground-muted [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className,
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return renderEmptySection(
    "empty-content",
    "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance",
    {
      className,
      ...props,
    },
  )
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
}
