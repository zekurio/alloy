"use client"

import { cn } from "@alloy/ui/lib/utils"
import { Select } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import type { ComponentProps } from "react"

const SelectRoot = Select.Root

function SelectGroup({ className, ...props }: Select.Group.Props) {
  return (
    <Select.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: Select.Value.Props) {
  return (
    <Select.Value
      data-slot="select-value"
      className={cn("flex flex-1 items-center text-left leading-4", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Select.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <Select.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-border bg-input py-1.5 pr-2.5 pl-3 text-base whitespace-nowrap transition-[border-color,background-color,box-shadow] outline-none select-none hover:border-border-strong hover:bg-surface-raised focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/15 aria-invalid:ring-inset data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:rounded-lg *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 sm:text-sm data-[size=default]:sm:h-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <Select.Icon
        render={
          <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4" />
        }
      />
    </Select.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: Select.Popup.Props &
  Pick<
    Select.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <Select.Portal>
      <Select.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <Select.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <Select.List>{children}</Select.List>
          <SelectScrollDownButton />
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  )
}

function SelectLabel({ className, ...props }: Select.GroupLabel.Props) {
  return (
    <Select.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: Select.Item.Props) {
  return (
    <Select.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-9 pl-3 text-sm leading-4 outline-hidden select-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "not-data-[variant=destructive]:focus:**:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <Select.ItemText className="flex flex-1 shrink-0 items-center gap-2 leading-4 whitespace-nowrap">
        {children}
      </Select.ItemText>
      <Select.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2.5 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </Select.ItemIndicator>
    </Select.Item>
  )
}

function SelectSeparator({ className, ...props }: Select.Separator.Props) {
  return (
    <Select.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof Select.ScrollUpArrow>) {
  return (
    <Select.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </Select.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof Select.ScrollDownArrow>) {
  return (
    <Select.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </Select.ScrollDownArrow>
  )
}

export {
  SelectRoot as Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
