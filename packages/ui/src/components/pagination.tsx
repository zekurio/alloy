import * as React from "react"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <Button
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn(className)}
      nativeButton={false}
      render={
        <a
          aria-current={isActive ? "page" : undefined}
          data-slot="pagination-link"
          data-active={isActive}
          {...props}
        />
      }
    />
  )
}

function PaginationDirectionLink({
  children,
  className,
  iconPosition,
  text,
  ...props
}: React.ComponentProps<typeof PaginationLink> & {
  children: React.ReactNode
  iconPosition: "start" | "end"
  text: string
}) {
  return (
    <PaginationLink
      size="default"
      className={cn(
        iconPosition === "start" ? "pl-1.5!" : "pr-1.5!",
        className
      )}
      {...props}
    >
      {children}
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  )
}

function renderPaginationDirectionLink(
  ariaLabel: string,
  iconPosition: "start" | "end",
  text: string,
  className: string | undefined,
  props: Omit<
    React.ComponentProps<typeof PaginationLink>,
    "children" | "className"
  >,
  icon: React.ReactNode
) {
  return (
    <PaginationDirectionLink
      aria-label={ariaLabel}
      className={className}
      iconPosition={iconPosition}
      text={text}
      {...props}
    >
      {icon}
    </PaginationDirectionLink>
  )
}

function createPaginationDirectionComponent({
  ariaLabel,
  defaultText,
  icon,
  iconPosition,
}: {
  ariaLabel: string
  defaultText: string
  icon: React.ReactNode
  iconPosition: "start" | "end"
}) {
  return function PaginationDirection({
    className,
    text = defaultText,
    ...props
  }: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
    return renderPaginationDirectionLink(
      ariaLabel,
      iconPosition,
      text,
      className,
      props,
      icon
    )
  }
}

const PaginationPrevious = createPaginationDirectionComponent({
  ariaLabel: "Go to previous page",
  defaultText: "Previous",
  icon: <ChevronLeftIcon data-icon="inline-start" />,
  iconPosition: "start",
})

const PaginationNext = createPaginationDirectionComponent({
  ariaLabel: "Go to next page",
  defaultText: "Next",
  icon: <ChevronRightIcon data-icon="inline-end" />,
  iconPosition: "end",
})

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
