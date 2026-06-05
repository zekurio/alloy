import { Input } from "@workspace/ui/components/input"
import * as React from "react"

import { clampInt, parseInteger } from "./shared"

type NumberInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

/**
 * Integer field that stays editable while you type.
 *
 * The admin cards keep their form state as numbers, so clamping the raw input
 * on every keystroke made the field impossible to use: clearing it snapped
 * straight back to the minimum and partial values were rewritten mid-type. This
 * keeps a local text buffer so the box can be empty or hold an out-of-range
 * value while editing, commits any complete integer (capped at `max`) so dirty
 * tracking still works, and clamps to the full range on blur.
 */
export function NumberInput({
  value,
  min,
  max,
  onChange,
  ...props
}: NumberInputProps) {
  const [text, setText] = React.useState(() => String(value))
  const [editing, setEditing] = React.useState(false)

  // Mirror external updates (reset, save, fetched config) when the user isn't
  // actively editing so we never clobber an in-progress entry.
  React.useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => {
        setEditing(true)
        props.onFocus?.(e)
      }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const parsed = parseInteger(raw)
        // Allow values below `min` while typing, but never let a typo exceed
        // the cap. Empty/invalid input commits nothing until blur.
        if (parsed !== null) onChange(Math.min(max, parsed))
      }}
      onBlur={(e) => {
        setEditing(false)
        const clamped = clampInt(text, min, max, value)
        setText(String(clamped))
        onChange(clamped)
        props.onBlur?.(e)
      }}
    />
  )
}
