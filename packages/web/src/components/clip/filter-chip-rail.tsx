import { Chip } from "@alloy/ui/components/chip"
import { cn } from "@alloy/ui/lib/utils"
import type { ReactElement, ReactNode } from "react"

import { FilterCarousel } from "@/components/filter-carousel"

export type FilterChipOption<K extends string> = {
  key: K
  label: string
  /** Leading visual (GameIcon/GlobeIcon/BanIcon). */
  icon?: ReactNode
}

const responsiveChipClass = cn(
  "h-9 px-3 text-sm leading-4",
  "[&_svg:not([class*='size-'])]:size-[18px] [&_[data-slot=game-icon]]:size-[18px]",
  "md:h-8 md:px-2.5 md:text-sm md:leading-4",
  "md:[&_svg:not([class*='size-'])]:size-4 md:[&_[data-slot=game-icon]]:size-4",
)

/** Label text: on mobile only the active chip keeps its visible label. */
function ChipLabel({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  // sr-only (not hidden) keeps the label in the accessible name.
  return (
    <span className={active ? undefined : "max-md:sr-only"}>{children}</span>
  )
}

type FilterChipRailProps<K extends string> = {
  options: ReadonlyArray<FilterChipOption<K>>
  activeKey: K
  /** Defaults to "min-w-0 flex-1" so the rail fills the toolbar row. */
  className?: string
  onSelect?: (key: K) => void
  renderOptionLink?: (
    option: FilterChipOption<K>,
    active: boolean,
  ) => ReactElement
}

export function FilterChipRail<K extends string>({
  options,
  activeKey,
  className,
  onSelect,
  renderOptionLink,
}: FilterChipRailProps<K>): ReactElement {
  return (
    <FilterCarousel className={cn("min-w-0 flex-1", className)}>
      {options.map((option) => {
        const active = option.key === activeKey

        if (renderOptionLink) {
          return (
            <Chip
              key={option.key}
              size="xl"
              className={responsiveChipClass}
              data-active={active ? "true" : undefined}
              render={renderOptionLink(option, active)}
            >
              {option.icon}
              <ChipLabel active={active}>{option.label}</ChipLabel>
            </Chip>
          )
        }

        return (
          <Chip
            key={option.key}
            size="xl"
            className={responsiveChipClass}
            data-active={active ? "true" : undefined}
            onClick={() => onSelect?.(option.key)}
          >
            {option.icon}
            <ChipLabel active={active}>{option.label}</ChipLabel>
          </Chip>
        )
      })}
    </FilterCarousel>
  )
}
