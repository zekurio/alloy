import * as React from "react"

import { FieldDescription } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import type { EncoderCodec, EncoderHwaccel } from "@workspace/api"
import { presetSuggestionsFor } from "./shared"

const CUSTOM_PRESET_VALUE = "__custom_preset__"
const INHERIT_PRESET_VALUE = "__inherit_preset__"

function formatPresetLabel(value: string | undefined, inheritedValue?: string) {
  if (value === undefined) {
    return inheritedValue !== undefined
      ? `Inherit (${inheritedValue})`
      : "Preset"
  }
  return value
}

export function EncoderPresetField({
  id,
  value,
  hwaccel,
  codec,
  inheritedValue,
  required = false,
  onChange,
}: {
  id: string
  value: string | undefined
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  inheritedValue?: string
  required?: boolean
  onChange: (next: string | undefined) => void
}) {
  const suggestions = React.useMemo(
    () => presetSuggestionsFor(hwaccel, codec),
    [codec, hwaccel]
  )
  const isVaapi = hwaccel === "vaapi"
  const isStoredCustom =
    value !== undefined && !suggestions.some((preset) => preset === value)

  const [customMode, setCustomMode] = React.useState(isStoredCustom)
  const [customDraft, setCustomDraft] = React.useState(
    isStoredCustom ? (value ?? "") : ""
  )

  React.useEffect(() => {
    if (isStoredCustom) {
      setCustomMode(true)
      setCustomDraft(value ?? "")
      return
    }
    if (!customMode) {
      setCustomDraft(value ?? "")
    }
  }, [customMode, isStoredCustom, value])

  if (isVaapi) {
    return (
      <>
        <Input id={id} value="Ignored by VA-API" disabled readOnly />
        <FieldDescription>
          VA-API doesn&apos;t expose a preset knob. Only the quality value is
          used.
        </FieldDescription>
      </>
    )
  }

  const selectValue = customMode
    ? CUSTOM_PRESET_VALUE
    : value === undefined && inheritedValue !== undefined
      ? INHERIT_PRESET_VALUE
      : (value ?? CUSTOM_PRESET_VALUE)
  const selectLabel = customMode
    ? "Custom preset"
    : formatPresetLabel(value, inheritedValue)

  return (
    <>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next == null) return
          if (next === INHERIT_PRESET_VALUE) {
            setCustomMode(false)
            setCustomDraft("")
            onChange(undefined)
            return
          }
          if (next === CUSTOM_PRESET_VALUE) {
            setCustomMode(true)
            if (isStoredCustom) {
              setCustomDraft(value ?? "")
            } else {
              setCustomDraft("")
              if (inheritedValue === undefined) {
                onChange("")
              }
            }
            return
          }
          setCustomMode(false)
          setCustomDraft(next)
          onChange(next)
        }}
      >
        <SelectTrigger id={customMode ? undefined : id} className="w-full">
          <SelectValue placeholder="Select a preset">{selectLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {inheritedValue !== undefined ? (
            <SelectItem value={INHERIT_PRESET_VALUE}>
              Inherit ({inheritedValue})
            </SelectItem>
          ) : null}
          {suggestions.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {preset}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM_PRESET_VALUE}>Custom…</SelectItem>
        </SelectContent>
      </Select>

      {customMode ? (
        <Input
          id={id}
          value={customDraft}
          required={required}
          placeholder="Enter raw ffmpeg preset"
          onChange={(e) => {
            const next = e.target.value
            setCustomDraft(next)
            if (inheritedValue !== undefined) {
              onChange(next === "" ? undefined : next)
            } else {
              onChange(next)
            }
          }}
        />
      ) : null}

      <FieldDescription>
        {inheritedValue !== undefined
          ? "Leave this on Inherit to use the global preset. Listed options are app-provided for the selected backend and codec, not probed from ffmpeg."
          : "Listed options are app-provided for the selected backend and codec, not probed from ffmpeg."}{" "}
        Use Custom for a raw ffmpeg value.
      </FieldDescription>
    </>
  )
}
