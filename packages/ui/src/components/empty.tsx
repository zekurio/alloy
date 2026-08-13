import { cn } from "@alloy/ui/lib/utils"
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

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(
        "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "icon" &&
          "size-10 rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
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
