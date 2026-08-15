import { t } from "@alloy/contracts/schema"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { cn } from "@alloy/ui/lib/utils"
import { forwardRef } from "react"
import type { ComponentProps, ReactNode } from "react"

function characterCount(value: ComponentProps<"input">["value"]) {
  if (value == null || Array.isArray(value)) return 0
  return String(value).length
}

function LimitCounter({ current, max }: { current: number; max: number }) {
  return (
    <span
      className="text-foreground-muted text-xs font-semibold tabular-nums"
      aria-hidden="true"
    >
      {current}/{max}
    </span>
  )
}

function renderLimitCounter(
  value: ComponentProps<"input">["value"],
  max: number | undefined,
  addonProps: ComponentProps<typeof InputGroupAddon>,
) {
  return max !== undefined ? (
    <InputGroupAddon {...addonProps}>
      <LimitCounter current={characterCount(value)} max={max} />
    </InputGroupAddon>
  ) : null
}

const MaxLengthSchema = t.number()

function maxFromLength(maxLength: string | number | undefined) {
  const result = MaxLengthSchema.safeParse(maxLength)
  return result.success ? result.data : undefined
}

function renderLimitedField(input: {
  groupClassName?: string
  control: ReactNode
  value: ComponentProps<"input">["value"]
  max: number | undefined
  addonProps: ComponentProps<typeof InputGroupAddon>
}) {
  return (
    <InputGroup className={input.groupClassName}>
      {input.control}
      {renderLimitCounter(input.value, input.max, input.addonProps)}
    </InputGroup>
  )
}

const LimitedInput = forwardRef<
  HTMLInputElement,
  ComponentProps<typeof InputGroupInput> & { groupClassName?: string }
>(function LimitedInput(
  { className, groupClassName, maxLength, value, ...props },
  ref,
) {
  const max = maxFromLength(maxLength)
  return renderLimitedField({
    groupClassName,
    value,
    max,
    addonProps: {
      align: "inline-end",
      className: "pointer-events-none pl-2",
    },
    control: (
      <InputGroupInput
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={cn("px-3", max !== undefined && "pr-0", className)}
        {...props}
      />
    ),
  })
})

export { LimitedInput }
