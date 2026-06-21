import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import {
  ArrowUpDownIcon,
  Clock3Icon,
  EyeIcon,
  HistoryIcon,
  SparklesIcon,
  TrophyIcon,
} from "lucide-react"
import type { ReactElement, ReactNode } from "react"

import {
  filterLabelClass,
  ToolbarChipTrigger,
  ToolbarIconButton,
} from "./toolbar-controls"

export type SortDropdownOption<K extends string> = {
  key: K
  label: string
  icon?: ReactNode
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
  ) => ReactElement
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
              <ToolbarIconButton
                aria-label={triggerLabel ?? label ?? "Sort"}
                title={triggerLabel ?? label ?? "Sort"}
              >
                {currentIcon ?? <ArrowUpDownIcon />}
              </ToolbarIconButton>
            ) : (
              <ToolbarChipTrigger icon={currentIcon} label={current?.label} />
            )
          }
        />
        <DropdownMenuContent
          align={triggerVariant === "icon" ? "end" : "start"}
          className={cn(
            triggerVariant === "icon" ? "!w-40 !min-w-40" : "!w-40 !min-w-40",
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
    case "recommended":
      return <SparklesIcon />
    case "views":
      return <EyeIcon />
    default:
      return null
  }
}
