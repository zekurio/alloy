import { isObjectRecord, type ContractJsonValue } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { SelectTrigger } from "@alloy/ui/components/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { cn } from "@alloy/ui/lib/utils"
import { RotateCcwIcon } from "lucide-react"
import type { ComponentProps } from "react"

/** Structural equality for config values: JSON-like data, any key order. */
export function sameConfigValue(
  a: ContractJsonValue,
  b: ContractJsonValue,
): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameConfigValue(item, b[index]))
    )
  }
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false
  const keys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter(
      (key) => a[key] !== undefined || b[key] !== undefined,
    ),
  )
  return [...keys].every((key) => sameConfigValue(a[key], b[key]))
}

export interface ResetToDefault<Value extends ContractJsonValue> {
  value: Value
  defaultValue: Value
  /** The default as the setting displays it. */
  label: string
  onReset: () => void
  disabled?: boolean
}

/**
 * Icon button that restores an admin setting to its default: the
 * environment's value, else Alloy's own. Saving the default drops the
 * override, so the setting follows the environment again. Renders nothing
 * while the value already is the default.
 */
export function ResetToDefaultButton<Value extends ContractJsonValue>({
  value,
  defaultValue,
  label,
  onReset,
  disabled,
  className,
}: ResetToDefault<Value> & { className?: string }) {
  if (sameConfigValue(value, defaultValue)) return null
  const name = t("Reset to default ({value})", { value: label })
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={name}
            disabled={disabled}
            onClick={onReset}
            className={className}
          >
            <RotateCcwIcon />
          </Button>
        }
      />
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

/** An input with {@link ResetToDefaultButton} at its end. */
export function ResettableInput<Value extends ContractJsonValue>({
  reset,
  className,
  ...props
}: Omit<ComponentProps<typeof InputGroupInput>, "className"> & {
  reset: ResetToDefault<Value>
  /** Sizes the field, button included. */
  className?: string
}) {
  return (
    <InputGroup className={className}>
      <InputGroupInput className="px-3" {...props} />
      {sameConfigValue(reset.value, reset.defaultValue) ? null : (
        <InputGroupAddon align="inline-end">
          <ResetToDefaultButton {...reset} />
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

/**
 * A select trigger with {@link ResetToDefaultButton} beside its chevron. A
 * button can't nest inside the trigger's own, so it sits over a gap the
 * trigger leaves for it.
 */
export function ResettableSelectTrigger<Value extends ContractJsonValue>({
  reset,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectTrigger>, "className"> & {
  reset: ResetToDefault<Value>
  /** Sizes the field, button included. */
  className?: string
}) {
  const changed = !sameConfigValue(reset.value, reset.defaultValue)
  return (
    <div className={cn("relative", className)}>
      <SelectTrigger className="w-full" {...props}>
        {children}
        {changed ? <span aria-hidden className="w-6 shrink-0" /> : null}
      </SelectTrigger>
      {changed ? (
        <ResetToDefaultButton
          {...reset}
          className="absolute top-1/2 right-8 -translate-y-1/2"
        />
      ) : null}
    </div>
  )
}
