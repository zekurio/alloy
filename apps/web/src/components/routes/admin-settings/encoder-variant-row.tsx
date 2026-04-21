import * as React from "react"
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect } from "@workspace/ui/components/native-select"

import {
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HEIGHT_SUGGESTIONS,
  type EncoderCodec,
} from "../../../lib/admin-api"
import { clampInt, presetSuggestionsFor, QUALITY_LABEL } from "./shared"

type IntInputProps = {
  id: string
  min: number
  max: number
  step?: number
  value: number
  onCommit: (next: number) => void
}

export function IntInput({
  id,
  min,
  max,
  step = 1,
  value,
  onCommit,
}: IntInputProps) {
  const [draft, setDraft] = React.useState(String(value))
  const lastCommitted = React.useRef(value)

  React.useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value
      setDraft(String(value))
    }
  }, [value])

  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw === "") return
        const n = Number(raw)
        if (!Number.isFinite(n)) return
        const clamped = Math.min(max, Math.max(min, Math.round(n)))
        lastCommitted.current = clamped
        onCommit(clamped)
      }}
      onBlur={() => {
        const n = Number(draft)
        if (draft === "" || !Number.isFinite(n)) {
          setDraft(String(lastCommitted.current))
        }
      }}
    />
  )
}

type VariantRowProps = {
  variant: AdminEncoderVariant
  index: number
  globalConfig: AdminEncoderConfig
  isDuplicate: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
  onChange: (next: AdminEncoderVariant) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

export function VariantRow({
  variant,
  index,
  globalConfig,
  isDuplicate,
  canMoveUp,
  canMoveDown,
  canDelete,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: VariantRowProps) {
  const [overridesOpen, setOverridesOpen] = React.useState(
    variant.codec !== undefined ||
      variant.quality !== undefined ||
      variant.preset !== undefined ||
      variant.audioBitrateKbps !== undefined
  )

  function set<K extends keyof AdminEncoderVariant>(
    key: K,
    value: AdminEncoderVariant[K]
  ) {
    onChange({ ...variant, [key]: value })
  }

  const heightId = `variant-${index}-height`
  const codecId = `variant-${index}-codec`
  const qualityId = `variant-${index}-quality`
  const presetId = `variant-${index}-preset`
  const audioId = `variant-${index}-audio`

  const overrideCount = [
    variant.codec,
    variant.quality,
    variant.preset,
    variant.audioBitrateKbps,
  ].filter((v) => v !== undefined).length

  const heightSuggestionsId = `variant-${index}-height-suggestions`

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Field className="grow">
          <FieldLabel htmlFor={heightId} className="sr-only">
            Height
          </FieldLabel>
          <Input
            id={heightId}
            type="number"
            min={ENCODER_HEIGHT_MIN}
            max={ENCODER_HEIGHT_MAX}
            step={2}
            list={heightSuggestionsId}
            value={variant.height}
            aria-invalid={isDuplicate || undefined}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10)
              if (!Number.isFinite(parsed)) return
              set("height", parsed)
            }}
          />
          <datalist id={heightSuggestionsId}>
            {ENCODER_HEIGHT_SUGGESTIONS.map((h) => (
              <option key={h} value={h}>
                {h}p
              </option>
            ))}
          </datalist>
          {isDuplicate ? (
            <FieldDescription className="text-destructive">
              Another rung already uses {variant.height}p.
            </FieldDescription>
          ) : null}
        </Field>

        {index === 0 ? (
          <Badge variant="secondary" className="text-xs">
            Default playback
          </Badge>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label="Move up"
          >
            <ChevronUpIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label="Move down"
          >
            <ChevronDownIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={!canDelete}
            aria-label="Remove variant"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>

      <Collapsible open={overridesOpen} onOpenChange={setOverridesOpen}>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-auto px-1 text-xs text-muted-foreground"
            >
              {overridesOpen ? "Hide" : "Show"} overrides
              {overrideCount > 0 ? ` (${overrideCount})` : ""}
            </Button>
          }
        />
        <CollapsibleContent className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={codecId}>Codec</FieldLabel>
              <NativeSelect
                id={codecId}
                value={variant.codec ?? ""}
                onChange={(e) => {
                  const raw = e.target.value
                  set(
                    "codec",
                    raw === "" ? undefined : (raw as EncoderCodec)
                  )
                }}
              >
                <option value="">
                  Inherit ({globalConfig.codec.toUpperCase()})
                </option>
                {ENCODER_CODECS.map((codec) => (
                  <option key={codec} value={codec}>
                    {codec.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor={qualityId}>
                Quality ({QUALITY_LABEL[globalConfig.hwaccel]})
              </FieldLabel>
              <Input
                id={qualityId}
                type="number"
                min={0}
                max={51}
                step={1}
                value={variant.quality ?? ""}
                placeholder={`Inherit (${globalConfig.quality})`}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === "") {
                    set("quality", undefined)
                  } else {
                    set("quality", clampInt(raw, 0, 51, variant.quality ?? 23))
                  }
                }}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={presetId}>Preset</FieldLabel>
              <Input
                id={presetId}
                list={`variant-${index}-preset-suggestions`}
                value={variant.preset ?? ""}
                placeholder={`Inherit (${globalConfig.preset})`}
                disabled={globalConfig.hwaccel === "vaapi"}
                onChange={(e) => {
                  const raw = e.target.value
                  set("preset", raw === "" ? undefined : raw)
                }}
              />
              <datalist id={`variant-${index}-preset-suggestions`}>
                {/* Follow the rung's effective codec so SVT-AV1's numeric
                 * presets don't leak into an H.264 rung. */}
                {presetSuggestionsFor(
                  globalConfig.hwaccel,
                  variant.codec ?? globalConfig.codec
                ).map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>

            <Field>
              <FieldLabel htmlFor={audioId}>Audio bitrate (kbps)</FieldLabel>
              <Input
                id={audioId}
                type="number"
                min={64}
                max={256}
                step={8}
                value={variant.audioBitrateKbps ?? ""}
                placeholder={`Inherit (${globalConfig.audioBitrateKbps})`}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === "") {
                    set("audioBitrateKbps", undefined)
                  } else {
                    set(
                      "audioBitrateKbps",
                      clampInt(raw, 64, 256, variant.audioBitrateKbps ?? 128)
                    )
                  }
                }}
              />
            </Field>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
