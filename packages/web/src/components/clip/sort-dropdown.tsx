import { Button } from "@alloy/ui/components/button"
import { Chip } from "@alloy/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  Clock3Icon,
  EyeIcon,
  HistoryIcon,
  TrophyIcon,
} from "lucide-react"
import * as React from "react"

export const filterLabelClass =
  "inline-flex h-8 items-center pr-1 text-xs leading-4 font-semibold tracking-wide text-foreground-muted uppercase"

export const toolbarIconButtonClass =
  "h-9 min-w-9 rounded-lg border-border bg-input px-2.5 text-foreground-muted hover:border-border-strong hover:bg-surface-raised hover:text-foreground max-md:size-10 max-md:min-w-10 max-md:rounded-md max-md:border-transparent max-md:bg-transparent max-md:px-0 max-md:text-foreground-faint max-md:hover:border-transparent max-md:hover:bg-surface-raised max-md:hover:text-foreground-muted max-md:[&_svg]:opacity-70 max-md:hover:[&_svg]:opacity-100 [&_svg:not([class*='size-'])]:size-4"

export type SortDropdownOption<K extends string> = {
  key: K
  label: string
  icon?: React.ReactNode
}

type SortDropdownProps<K extends string> = {
  /** Optional uppercase label rendered before the trigger (e.g. "Sort"). */
  label?: string
  triggerLabel?: string
  triggerVariant?: "chip" | "icon"
  value: K
  options: ReadonlyArray<SortDropdownOption<K>>
  contentClassName?: string
  /**
   * Render the navigation target for an option as a router `<Link>`. Keeping
   * the route wiring at the call site lets a single dropdown serve different
   * routes (profile sort, home top-clips window, ...) without duplication.
   */
  renderOptionLink: (
    option: SortDropdownOption<K>,
    active: boolean,
  ) => React.ReactElement
}

export function SortDropdown<K extends string>({
  label,
  triggerLabel,
  triggerVariant = "chip",
  value,
  options,
  contentClassName,
  renderOptionLink,
}: SortDropdownProps<K>) {
  const current = options.find((o) => o.key === value) ?? options[0]
  const currentIcon = current?.icon ?? defaultSortIcon(current?.key)

  return (
    <div className="flex items-center gap-1.5">
      {label ? <span className={filterLabelClass}>{label}</span> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            triggerVariant === "icon" ? (
              <Button
                variant="secondary"
                size="sm"
                className={toolbarIconButtonClass}
                aria-label={triggerLabel ?? label ?? "Sort"}
                title={triggerLabel ?? label ?? "Sort"}
              >
                {currentIcon ?? <ArrowUpDownIcon />}
              </Button>
            ) : (
              <Chip
                size="xl"
                data-active="true"
                className="w-[11.25rem] justify-between"
              >
                {currentIcon}
                <span className="min-w-0 flex-1 truncate text-left">
                  {current?.label}
                </span>
                <ChevronDownIcon />
              </Chip>
            )
          }
        />
        <DropdownMenuContent
          align={triggerVariant === "icon" ? "end" : "start"}
          className={cn(
            triggerVariant === "icon"
              ? "!w-40 !min-w-40"
              : "!w-(--anchor-width) !min-w-(--anchor-width)",
            contentClassName,
          )}
        >
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.key}
              render={renderOptionLink(opt, opt.key === value)}
            >
              {opt.icon ?? defaultSortIcon(opt.key)}
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function defaultSortIcon(key: string | undefined) {
  switch (key) {
    case "recent":
      return <Clock3Icon />
    case "oldest":
      return <HistoryIcon />
    case "top":
      return <TrophyIcon />
    case "views":
      return <EyeIcon />
    default:
      return null
  }
}
