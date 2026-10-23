import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import type { ReactNode } from "react"

export interface OptionSelectProps<T extends string | number> {
  id: string
  value: T
  options: readonly T[]
  optionLabel: (option: T) => ReactNode
  /** Lists an option without letting it be picked. */
  optionDisabled?: (option: T) => boolean
  disabled?: boolean
  onValueChange: (value: T) => void
  className?: string
  align: "start" | "end"
}

/**
 * A select over a fixed list of setting values. The picked item is matched
 * back to its option, so numbers work too and nothing outside `options` is
 * ever reported.
 */
export function OptionSelect<T extends string | number>({
  id,
  value,
  options,
  optionLabel,
  optionDisabled,
  disabled,
  onValueChange,
  className,
  align,
}: OptionSelectProps<T>) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((candidate) => String(candidate) === next)
        if (option !== undefined) onValueChange(option)
      }}
    >
      <SelectTrigger id={id} size="sm" className={className}>
        <SelectValue>{optionLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent align={align}>
        {options.map((option) => (
          <SelectItem
            key={option}
            value={String(option)}
            disabled={optionDisabled?.(option)}
          >
            {optionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
