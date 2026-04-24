import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import type { EncoderCodec, EncoderHwaccel } from "@workspace/api"

export function EncoderPresetField({
  id,
  value,
  hwaccel,
  codec: _codec,
  inheritedValue,
  required = false,
  showDescription = true,
  onChange,
}: {
  id: string
  value: string | undefined
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  inheritedValue?: string
  required?: boolean
  showDescription?: boolean
  onChange: (next: string | undefined) => void
}) {
  const isVaapi = hwaccel === "vaapi"
  const [draft, setDraft] = React.useState(value ?? "")

  React.useEffect(() => {
    setDraft(value ?? "")
  }, [value])

  if (isVaapi) {
    return (
      <>
        <Input id={id} value="Ignored by VA-API" disabled readOnly />
        {showDescription ? (
          <FieldDescription>
            VA-API doesn&apos;t expose a preset knob. Only the quality value is
            used.
          </FieldDescription>
        ) : null}
      </>
    )
  }

  function formatInheritedPresetLabel(inherited: string) {
    return inherited === ""
      ? "Inherit (global custom preset)"
      : `Inherit (${inherited})`
  }

  return (
    <>
      <Input
        id={id}
        value={draft}
        required={required}
        placeholder={
          inheritedValue !== undefined
            ? formatInheritedPresetLabel(inheritedValue)
            : "Raw ffmpeg preset"
        }
        aria-invalid={(required && draft.trim() === "") || undefined}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          onChange(
            next.trim() === "" && inheritedValue !== undefined
              ? undefined
              : next
          )
        }}
      />

      {showDescription ? (
        <FieldDescription>
          {inheritedValue !== undefined
            ? "Leave empty to inherit the global preset."
            : "Raw ffmpeg preset value for the selected backend and codec."}
        </FieldDescription>
      ) : null}
    </>
  )
}
