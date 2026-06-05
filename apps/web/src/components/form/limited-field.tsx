import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

function characterCount(value: React.ComponentProps<"input">["value"]) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).length
  }
  return 0
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
  value: React.ComponentProps<"input">["value"],
  max: number | undefined,
  addonProps: React.ComponentProps<typeof InputGroupAddon>,
) {
  return max !== undefined ? (
    <InputGroupAddon {...addonProps}>
      <LimitCounter current={characterCount(value)} max={max} />
    </InputGroupAddon>
  ) : null
}

function maxFromLength(maxLength: string | number | undefined) {
  return typeof maxLength === "number" ? maxLength : undefined
}

function renderLimitedField(input: {
  groupClassName?: string
  control: React.ReactNode
  value: React.ComponentProps<"input">["value"]
  max: number | undefined
  addonProps: React.ComponentProps<typeof InputGroupAddon>
}) {
  return (
    <InputGroup className={input.groupClassName}>
      {input.control}
      {renderLimitCounter(input.value, input.max, input.addonProps)}
    </InputGroup>
  )
}

const LimitedInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof InputGroupInput> & { groupClassName?: string }
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

const LimitedTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<typeof InputGroupTextarea> & { groupClassName?: string }
>(function LimitedTextarea(
  { className, groupClassName, maxLength, value, ...props },
  ref,
) {
  const max = maxFromLength(maxLength)
  return renderLimitedField({
    groupClassName: cn("h-auto", groupClassName),
    value,
    max,
    addonProps: {
      align: "block-end",
      className: "pointer-events-none pt-1",
    },
    control: (
      <InputGroupTextarea
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={cn("px-3.5", max !== undefined && "pb-0", className)}
        {...props}
      />
    ),
  })
})

export { LimitedInput, LimitedTextarea }
