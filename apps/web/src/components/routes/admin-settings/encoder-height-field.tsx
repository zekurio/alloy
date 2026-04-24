import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { ENCODER_HEIGHT_MAX, ENCODER_HEIGHT_MIN } from "@workspace/api"

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
  const measureRef = React.useRef<HTMLSpanElement>(null)
  const [suffixOffset, setSuffixOffset] = React.useState(0)

  React.useEffect(() => {
    setCustomDraft(String(value))
  }, [value])

  React.useEffect(() => {
    if (measureRef.current) {
      setSuffixOffset(measureRef.current.offsetWidth)
    }
  }, [customDraft])

  const parsedDraft = Number.parseInt(customDraft, 10)
  const customInvalid =
    customDraft.trim() === "" ||
    !Number.isFinite(parsedDraft) ||
    parsedDraft < ENCODER_HEIGHT_MIN ||
    parsedDraft > ENCODER_HEIGHT_MAX ||
    parsedDraft % 2 !== 0

  return (
    <>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={ENCODER_HEIGHT_MIN}
          max={ENCODER_HEIGHT_MAX}
          step={2}
          value={customDraft}
          required
          aria-invalid={ariaInvalid || customInvalid || undefined}
          placeholder="Height"
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
        {/* Invisible text to measure the width of the current value */}
        <span
          ref={measureRef}
          className="pointer-events-none invisible absolute inset-y-0 left-3.5 flex items-center text-base"
          aria-hidden="true"
        >
          {customDraft}
        </span>
        {/* "p" suffix positioned right after the number */}
        <span
          className="pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted-foreground"
          style={{ left: `calc(0.875rem + ${suffixOffset}px + 0.2rem)` }}
        >
          p
        </span>
      </div>

      {showDescription ? (
        <FieldDescription>
          Use any even output height between {ENCODER_HEIGHT_MIN}p and{" "}
          {ENCODER_HEIGHT_MAX}p.
        </FieldDescription>
      ) : null}
    </>
  )
}
