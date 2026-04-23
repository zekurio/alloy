import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"

import {
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
} from "@workspace/api"

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
  const [customDraft, setCustomDraft] = React.useState(String(value))

  React.useEffect(() => {
    setCustomDraft(String(value))
  }, [value])

  const parsedDraft = Number.parseInt(customDraft, 10)
  const customInvalid =
    customDraft.trim() === "" ||
    !Number.isFinite(parsedDraft) ||
    parsedDraft < ENCODER_HEIGHT_MIN ||
    parsedDraft > ENCODER_HEIGHT_MAX ||
    parsedDraft % 2 !== 0

  return (
    <>
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
          placeholder="Height"
          className="pl-3 text-right"
          onChange={(e) => {
            const raw = e.target.value
            setCustomDraft(raw)
            const parsed = Number.parseInt(raw, 10)
            if (raw === "" || !Number.isFinite(parsed)) return
            onChange(parsed)
          }}
          onBlur={() => {
            if (customInvalid) setCustomDraft(String(value))
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>p</InputGroupText>
        </InputGroupAddon>
      </InputGroup>

      {showDescription ? (
        <FieldDescription>
          Use any even output height between {ENCODER_HEIGHT_MIN}p and{" "}
          {ENCODER_HEIGHT_MAX}p.
        </FieldDescription>
      ) : null}
    </>
  )
}
