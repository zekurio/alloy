import { t } from "@alloy/i18n"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@alloy/ui/components/combobox"
import { InputGroupAddon } from "@alloy/ui/components/input-group"
import { cn } from "@alloy/ui/lib/utils"
import { FunnelIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"

import {
  filterLabelClass,
  ToolbarChipTrigger,
  ToolbarIconButton,
} from "./toolbar-controls"

/** Once the option count crosses this, the popup grows a search field. */
const SEARCH_THRESHOLD = 8

export type FilterDropdownOption<K extends string> = {
  key: K
  label: string
  /** Leading visual rendered in both the trigger and the menu row. */
  icon?: ReactNode
  /** Trailing count shown muted + tabular in the menu row. */
  count?: number
}

type FilterDropdownProps<K extends string> = {
  /** Optional uppercase label rendered before the trigger (e.g. "Game"). */
  label?: string
  triggerLabel?: string
  triggerVariant?: "chip" | "icon"
  value: K
  options: ReadonlyArray<FilterDropdownOption<K>>
  onSelect: (key: K) => void
  contentClassName?: string
  /** Show the search field once the option count reaches this many. */
  searchThreshold?: number
  /** Placeholder for the search field. */
  searchPlaceholder?: string
}

/**
 * A game/scope filter rendered as a single control rather than a chip rail.
 * The closed state mirrors {@link SortDropdown}'s Chip-styled trigger; once the
 * option list grows past {@link SEARCH_THRESHOLD} the popup adds a type-to-filter
 * search field so a long game list stays navigable.
 */
export function FilterDropdown<K extends string>({
  label,
  triggerLabel,
  triggerVariant = "chip",
  value,
  options,
  onSelect,
  contentClassName,
  searchThreshold = SEARCH_THRESHOLD,
  searchPlaceholder = t("Search…"),
}: FilterDropdownProps<K>) {
  const current = options.find((o) => o.key === value) ?? options[0]
  const [query, setQuery] = useState("")
  const searchable = options.length > searchThreshold

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {label ? <span className={filterLabelClass}>{label}</span> : null}
      <Combobox<FilterDropdownOption<K>>
        items={options as FilterDropdownOption<K>[]}
        value={current ?? null}
        onValueChange={(opt) => {
          if (opt) onSelect(opt.key)
        }}
        itemToStringLabel={(opt) => opt.label}
        isItemEqualToValue={(a, b) => a?.key === b?.key}
        inputValue={query}
        onInputValueChange={setQuery}
        onOpenChange={(open) => {
          // Reset the filter so reopening always starts from the full list.
          if (!open) setQuery("")
        }}
        autoHighlight
      >
        <ComboboxTrigger
          render={
            triggerVariant === "icon" ? (
              <ToolbarIconButton
                className="max-w-[8rem]"
                aria-label={triggerLabel ?? label ?? t("Filter")}
                title={triggerLabel ?? label ?? t("Filter")}
              >
                {current?.icon ?? <FunnelIcon />}
              </ToolbarIconButton>
            ) : (
              <ToolbarChipTrigger icon={current?.icon} label={current?.label} />
            )
          }
        />
        <ComboboxContent
          align={triggerVariant === "icon" ? "end" : "start"}
          className={cn(
            "alloy-blur border ring-0",
            triggerVariant === "icon" ? "!w-64 !min-w-64" : "!w-56 !min-w-56",
            contentClassName,
          )}
        >
          {searchable ? (
            <ComboboxInput placeholder={searchPlaceholder} showTrigger={false}>
              <InputGroupAddon align="inline-start">
                <SearchIcon className="text-foreground-faint size-4" />
              </InputGroupAddon>
            </ComboboxInput>
          ) : null}
          <ComboboxList>
            {(opt: FilterDropdownOption<K>) => (
              <ComboboxItem
                key={opt.key}
                value={opt}
                className="h-8 gap-2.5 py-0 pr-9 pl-2.5"
              >
                {opt.icon}
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.count !== undefined ? (
                  <span className="text-foreground-faint tabular-nums">
                    {opt.count}
                  </span>
                ) : null}
              </ComboboxItem>
            )}
          </ComboboxList>
          {searchable ? <ComboboxEmpty>{t("No matches")}</ComboboxEmpty> : null}
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
