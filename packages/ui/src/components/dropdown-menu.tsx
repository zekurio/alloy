import { cn } from "@alloy/ui/lib/utils"
import { Menu } from "@base-ui/react/menu"
import { CheckIcon, ChevronRightIcon } from "lucide-react"
import type { ComponentProps } from "react"

function DropdownMenu({ ...props }: Menu.Root.Props) {
  return <Menu.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: Menu.Portal.Props) {
  return <Menu.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: Menu.Trigger.Props) {
  return <Menu.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  portalContainer,
  className,
  ...props
}: Menu.Popup.Props &
  Pick<
    Menu.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  > & {
    portalContainer?: Menu.Portal.Props["container"]
  }) {
  return (
    <Menu.Portal container={portalContainer}>
      <Menu.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) w-(--anchor-width) min-w-[180px]",
            "overflow-x-hidden overflow-y-auto rounded-md bg-surface-raised p-0.5 text-foreground",
            "border border-border-strong shadow-md",
            "duration-100 outline-none",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function DropdownMenuGroup({ ...props }: Menu.Group.Props) {
  return <Menu.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: Menu.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <Menu.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1 font-mono text-2xs tracking-[0.1em] text-foreground-faint uppercase",
        "data-inset:pl-6",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: Menu.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <Menu.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex h-8 items-center gap-2.5 rounded-md px-3",
        "cursor-default text-sm leading-4 text-foreground-muted outline-none select-none",
        "transition-colors",
        "focus:bg-neutral-150 focus:text-foreground data-highlighted:bg-neutral-150 data-highlighted:text-foreground",
        "data-inset:pl-6",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "data-[variant=destructive]:text-danger",
        "data-[variant=destructive]:focus:bg-[oklch(0.65_0.24_25/0.14)] data-[variant=destructive]:focus:text-danger",
        "data-[variant=destructive]:data-highlighted:bg-[oklch(0.65_0.24_25/0.14)] data-[variant=destructive]:data-highlighted:text-danger",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-foreground-dim",
        "data-[variant=destructive]:[&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: Menu.SubmenuRoot.Props) {
  return <Menu.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Menu.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <Menu.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex h-8 cursor-default items-center gap-2.5 rounded-md px-3 text-sm leading-4 text-foreground-muted outline-none select-none",
        "focus:bg-neutral-150 focus:text-foreground",
        "data-popup-open:bg-neutral-150 data-popup-open:text-foreground data-open:bg-neutral-150 data-open:text-foreground",
        "data-inset:pl-6",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </Menu.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  portalContainer,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("min-w-[160px]", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      portalContainer={portalContainer}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: Menu.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <Menu.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex h-8 cursor-default items-center gap-2.5 rounded-md pr-8 pl-3 text-sm leading-4 text-foreground-muted outline-none select-none",
        "focus:bg-neutral-150 focus:text-foreground",
        "data-inset:pl-6",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="text-accent pointer-events-none absolute right-2 inline-flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <Menu.CheckboxItemIndicator>
          <CheckIcon />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: Menu.RadioGroup.Props) {
  return <Menu.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: Menu.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <Menu.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex h-8 cursor-default items-center gap-2.5 rounded-md pr-8 pl-3 text-sm leading-4 text-foreground-muted outline-none select-none",
        "focus:bg-neutral-150 focus:text-foreground",
        "data-inset:pl-6",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="text-accent pointer-events-none absolute right-2 inline-flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <Menu.RadioItemIndicator>
          <CheckIcon />
        </Menu.RadioItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  )
}

function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return (
    <Menu.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-0.5 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto font-mono text-2xs tracking-[0.06em] text-foreground-faint uppercase",
        "group-focus/dropdown-menu-item:text-foreground-muted",
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
