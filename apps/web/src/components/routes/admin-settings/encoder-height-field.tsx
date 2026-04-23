import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import {
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HEIGHT_SUGGESTIONS,
} from "@workspace/api"

const CUSTOM_HEIGHT_VALUE = "__custom_height__"

function formatHeightLabel(height: number) {
  return `${height}p`
}

export function EncoderHeightField({
  id,
  value,
  ariaInvalid,
  onChange,
}: {
  id: string
  value: number
  ariaInvalid?: boolean
  onChange: (next: number) => void
}) {
  const isSuggested = (
    ENCODER_HEIGHT_SUGGESTIONS as readonly number[]
  ).includes(value)
  const [customMode, setCustomMode] = React.useState(!isSuggested)
  const [customDraft, setCustomDraft] = React.useState(String(value))

  React.useEffect(() => {
    if (!isSuggested) {
      setCustomMode(true)
      setCustomDraft(String(value))
      return
    }
    if (!customMode) {
      setCustomDraft(String(value))
    }
  }, [customMode, isSuggested, value])

  const selectValue = customMode ? CUSTOM_HEIGHT_VALUE : String(value)
  const selectLabel = customMode ? "Custom height" : formatHeightLabel(value)

  return (
    <>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next == null) return
          if (next === CUSTOM_HEIGHT_VALUE) {
            setCustomMode(true)
            setCustomDraft(String(value))
            return
          }
          const parsed = Number.parseInt(next, 10)
          if (!Number.isFinite(parsed)) return
          setCustomMode(false)
          setCustomDraft(String(parsed))
          onChange(parsed)
        }}
      >
        <SelectTrigger id={customMode ? undefined : id} className="w-full">
          <SelectValue>{selectLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {ENCODER_HEIGHT_SUGGESTIONS.map((height) => (
            <SelectItem key={height} value={String(height)}>
              {formatHeightLabel(height)}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM_HEIGHT_VALUE}>Custom…</SelectItem>
        </SelectContent>
      </Select>

      {customMode ? (
        <InputGroup>
          <InputGroupInput
            id={id}
            type="number"
            min={ENCODER_HEIGHT_MIN}
            max={ENCODER_HEIGHT_MAX}
            step={2}
            value={customDraft}
            aria-invalid={ariaInvalid || undefined}
            placeholder="Enter a custom height"
            onChange={(e) => {
              const raw = e.target.value
              setCustomDraft(raw)
              const parsed = Number.parseInt(raw, 10)
              if (raw === "" || !Number.isFinite(parsed)) return
              onChange(parsed)
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>p</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      ) : null}

      <FieldDescription>
        Pick a common playback rung, or use Custom for any even output height
        between {ENCODER_HEIGHT_MIN}p and {ENCODER_HEIGHT_MAX}p.
      </FieldDescription>
    </>
  )
}
