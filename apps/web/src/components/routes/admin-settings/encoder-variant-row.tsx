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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import {
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  ENCODER_CODECS,
  type EncoderCodec,
} from "@workspace/api"
import { EncoderHeightField } from "./encoder-height-field"
import { EncoderPresetField } from "./encoder-preset-field"
import { clampInt, normalizeVariantPreset, QUALITY_LABEL } from "./shared"

type IntInputProps = {
  id: string
  min: number
  max: number
  step?: number
  value: number
  onCommit: (next: number) => void
}

const INHERIT_CODEC_VALUE = "__inherit__"

function codecLabel(
  codec: AdminEncoderVariant["codec"],
  inheritedCodec: EncoderCodec
) {
  return codec?.toUpperCase() ?? `Inherit (${inheritedCodec.toUpperCase()})`
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

  function setCodec(nextCodec: EncoderCodec | undefined) {
    onChange({
      ...variant,
      codec: nextCodec,
      preset: normalizeVariantPreset(
        globalConfig.hwaccel,
        nextCodec ?? globalConfig.codec,
        variant.preset
      ),
    })
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

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Field className="grow">
          <FieldLabel htmlFor={heightId} className="sr-only">
            Height
          </FieldLabel>
          <EncoderHeightField
            id={heightId}
            value={variant.height}
            ariaInvalid={isDuplicate}
            onChange={(next) => set("height", next)}
          />
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
              <Select
                value={variant.codec ?? INHERIT_CODEC_VALUE}
                onValueChange={(value) => {
                  setCodec(
                    value === INHERIT_CODEC_VALUE
                      ? undefined
                      : (value as EncoderCodec)
                  )
                }}
              >
                <SelectTrigger id={codecId} className="w-full">
                  <SelectValue>
                    {codecLabel(variant.codec, globalConfig.codec)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value={INHERIT_CODEC_VALUE}>
                    Inherit ({globalConfig.codec.toUpperCase()})
                  </SelectItem>
                  {ENCODER_CODECS.map((codec) => (
                    <SelectItem key={codec} value={codec}>
                      {codec.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <EncoderPresetField
                id={presetId}
                value={variant.preset}
                inheritedValue={globalConfig.preset}
                hwaccel={globalConfig.hwaccel}
                codec={variant.codec ?? globalConfig.codec}
                onChange={(next) => set("preset", next)}
              />
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
