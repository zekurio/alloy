import * as React from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"

function characterCount(value: React.ComponentProps<"input">["value"]) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).length
  }
  return 0
}

function LimitCounter({ current, max }: { current: number; max: number }) {
  return (
    <span
      className="text-xs font-semibold text-foreground-muted tabular-nums"
      aria-hidden="true"
    >
      {current}/{max}
    </span>
  )
}

const LimitedInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof InputGroupInput> & { groupClassName?: string }
>(function LimitedInput(
  { className, groupClassName, maxLength, value, ...props },
  ref
) {
  const max = typeof maxLength === "number" ? maxLength : undefined

  return (
    <InputGroup className={groupClassName}>
      <InputGroupInput
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={cn("px-3", max !== undefined && "pr-0", className)}
        {...props}
      />
      {max !== undefined ? (
        <InputGroupAddon
          align="inline-end"
          className="pointer-events-none pl-2"
        >
          <LimitCounter current={characterCount(value)} max={max} />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
})

const LimitedTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<typeof InputGroupTextarea> & { groupClassName?: string }
>(function LimitedTextarea(
  { className, groupClassName, maxLength, value, ...props },
  ref
) {
  const max = typeof maxLength === "number" ? maxLength : undefined

  return (
    <InputGroup className={cn("h-auto", groupClassName)}>
      <InputGroupTextarea
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={cn("px-3.5", max !== undefined && "pb-0", className)}
        {...props}
      />
      {max !== undefined ? (
        <InputGroupAddon align="block-end" className="pointer-events-none pt-1">
          <LimitCounter current={characterCount(value)} max={max} />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
})

export { LimitedInput, LimitedTextarea }
