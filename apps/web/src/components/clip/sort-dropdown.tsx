import { Chip } from "@workspace/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { ChevronDownIcon } from "lucide-react"
import * as React from "react"

export const filterLabelClass =
  "inline-flex h-8 items-center pr-1 text-xs leading-4 font-semibold tracking-wide text-foreground-muted uppercase"

export type SortDropdownOption<K extends string> = {
  key: K
  label: string
}

type SortDropdownProps<K extends string> = {
  /** Optional uppercase label rendered before the trigger (e.g. "Sort"). */
  label?: string
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
  value,
  options,
  contentClassName = "w-44",
  renderOptionLink,
}: SortDropdownProps<K>) {
  const current = options.find((o) => o.key === value) ?? options[0]

  return (
    <div className="flex items-center gap-1.5">
      {label ? <span className={filterLabelClass}>{label}</span> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Chip size="xl" data-active="true">
              {current?.label}
              <ChevronDownIcon />
            </Chip>
          }
        />
        <DropdownMenuContent className={contentClassName}>
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.key}
              render={renderOptionLink(opt, opt.key === value)}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
