import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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

function closestSuggestedHeight(value: number) {
  let closest: number = ENCODER_HEIGHT_SUGGESTIONS[0] ?? ENCODER_HEIGHT_MIN
  for (const height of ENCODER_HEIGHT_SUGGESTIONS) {
    if (Math.abs(height - value) < Math.abs(closest - value)) {
      closest = height
    }
  }
  return closest
}

export function EncoderHeightField({
  id,
  value,
  ariaInvalid,
  showDescription = true,
  onChange,
}: {
  id: string
  value: number
  ariaInvalid?: boolean
  showDescription?: boolean
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
  const customInvalid = customMode && customDraft.trim() === ""

  return (
    <>
      {customMode ? (
        <InputGroup>
          <InputGroupInput
            id={id}
            type="number"
            min={ENCODER_HEIGHT_MIN}
            max={ENCODER_HEIGHT_MAX}
            step={2}
            value={customDraft}
            required
            aria-invalid={ariaInvalid || customInvalid || undefined}
            placeholder="Custom height"
            className="text-right"
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
            <InputGroupButton
              size="xs"
              aria-label="Use suggested heights"
              onClick={() => {
                const next = closestSuggestedHeight(value)
                setCustomMode(false)
                setCustomDraft(String(next))
                onChange(next)
              }}
            >
              List
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
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
          <SelectTrigger
            id={customMode ? undefined : id}
            className={customMode ? "w-40 shrink-0" : "w-full"}
          >
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
      )}

      {showDescription ? (
        <FieldDescription>
          Pick a common playback rung, or use Custom for any even output height
          between {ENCODER_HEIGHT_MIN}p and {ENCODER_HEIGHT_MAX}p.
        </FieldDescription>
      ) : null}
    </>
  )
}
