import { TRANSCODE_VIDEO_CODECS } from "@alloy/api"
import type { VideoCodec } from "@alloy/api"
import { deriveRenditionNames } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@alloy/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { cn } from "@alloy/ui/lib/utils"
import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useId, useMemo } from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import {
  effectiveOgTierIndex,
  firstTierError,
  nextTierHeight,
  parseNumberInput,
  suggestMaxrateKbps,
  VIDEO_CODEC_LABELS,
} from "./admin-transcoding-validation"
import type {
  LadderTier,
  TranscodingForm,
  validateForm,
} from "./admin-transcoding-validation"

const LADDER_GRID_CLASS =
  "sm:grid sm:grid-cols-[7rem_6rem_5rem_7rem_minmax(10rem,1fr)_5.5rem_2rem] sm:items-center sm:gap-3"

export function TranscodingLadder({
  form,
  validation,
  setForm,
}: {
  form: TranscodingForm
  validation: ReturnType<typeof validateForm>
  setForm: Dispatch<SetStateAction<TranscodingForm>>
}) {
  const tierNames = useMemo(
    () =>
      deriveRenditionNames(
        form.tiers.map((tier) => ({
          height: tier.height,
          fps: tier.maxFps,
          codec: tier.codec ?? form.videoCodec,
        })),
      ),
    [form.tiers, form.videoCodec],
  )
  const ogIndex = effectiveOgTierIndex(form.tiers)
  const ogRadioName = useId()

  function addTier() {
    setForm((current) => {
      if (current.tiers.length >= 6) return current
      const height = nextTierHeight(current.tiers)
      const tier: LadderTier = {
        id: crypto.randomUUID(),
        height,
        maxFps: 60,
        maxrateKbps: suggestMaxrateKbps(height),
        codec: null,
        og: false,
      }
      return {
        ...current,
        tiers: [...current.tiers, tier].sort((a, b) => b.height - a.height),
      }
    })
  }

  function updateTier(index: number, patch: Partial<LadderTier>) {
    setForm((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier,
      ),
    }))
  }

  function removeTier(index: number) {
    setForm((current) => {
      if (current.tiers.length <= 1) return current
      return {
        ...current,
        tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index),
      }
    })
  }

  function setOgTier(index: number) {
    setForm((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) => ({
        ...tier,
        og: tierIndex === index,
      })),
    }))
  }

  return (
    <div className="border-border flex flex-col gap-3 border-t pt-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{t("Rendition ladder")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addTier}
          disabled={form.tiers.length >= 6}
          className="shrink-0"
        >
          <PlusIcon />
          {t("Add tier")}
        </Button>
      </div>
      <p className="text-foreground-dim text-xs">
        {t(
          "Every upload is encoded into these renditions. Tiers above the source resolution are skipped, and the selected link preview tier powers social embeds.",
        )}
      </p>

      <div className="border-border overflow-hidden rounded-lg border">
        <LadderHeader />
        <div className="divide-border divide-y">
          {form.tiers.map((tier, index) => (
            <div
              key={tier.id}
              className={cn(
                "flex flex-wrap items-start gap-3 p-3",
                LADDER_GRID_CLASS,
              )}
            >
              <div className="flex min-w-16 flex-col gap-1.5 sm:min-w-0">
                <span className="text-foreground-muted text-xs font-medium sm:hidden">
                  {t("Rendition")}
                </span>
                <span className="bg-muted text-foreground-muted text-2xs w-fit rounded px-1.5 py-0.5 font-mono">
                  {Number.isFinite(tier.height) ? tierNames[index] : "–"}
                </span>
              </div>
              <LadderField
                label={t("Height")}
                unit={t("px")}
                min={144}
                max={4320}
                value={tier.height}
                error={validation.rows[index]?.height}
                className="w-24 flex-none"
                hideLabelOnDesktop
                onChange={(height) => updateTier(index, { height })}
              />
              <LadderField
                label={t("Max FPS")}
                unit={t("fps")}
                min={1}
                max={240}
                value={tier.maxFps}
                error={validation.rows[index]?.maxFps}
                className="w-20 flex-none"
                hideLabelOnDesktop
                onChange={(maxFps) => updateTier(index, { maxFps })}
              />
              <LadderField
                label={t("Max bitrate")}
                unit={t("kbps")}
                min={100}
                max={100000}
                value={tier.maxrateKbps}
                error={validation.rows[index]?.maxrateKbps}
                className="w-28 flex-none"
                hideLabelOnDesktop
                onChange={(maxrateKbps) => updateTier(index, { maxrateKbps })}
              />
              <LadderCodecField
                value={tier.codec}
                defaultCodec={form.videoCodec}
                error={validation.rows[index]?.codec}
                className="min-w-40 flex-1 sm:min-w-0"
                hideLabelOnDesktop
                onChange={(codec) => updateTier(index, { codec })}
              />
              <div className="ml-auto flex items-center justify-center gap-1.5 self-end sm:ml-0 sm:self-center">
                <span className="text-foreground-muted text-xs font-medium sm:hidden">
                  {t("Link preview")}
                </span>
                <LadderPreviewRadio
                  name={ogRadioName}
                  checked={index === ogIndex}
                  onChange={() => setOgTier(index)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeTier(index)}
                disabled={form.tiers.length <= 1}
                aria-label={t("Remove tier")}
                className="self-end sm:self-center"
              >
                <Trash2Icon />
              </Button>
              {firstTierError(validation.rows[index]) ? (
                <p className="text-destructive text-2xs w-full sm:col-span-full">
                  {firstTierError(validation.rows[index])}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {validation.formMessage ? (
        <Callout tone="destructive" className="text-xs">
          <TriangleAlertIcon />
          {validation.formMessage}
        </Callout>
      ) : null}
    </div>
  )
}

function LadderHeader() {
  return (
    <div
      className={cn(
        "bg-muted/30 text-foreground-muted hidden px-3 py-2 text-xs font-medium",
        LADDER_GRID_CLASS,
      )}
    >
      <span>{t("Rendition")}</span>
      <span>{t("Height")}</span>
      <span>{t("Max FPS")}</span>
      <span>{t("Max bitrate")}</span>
      <span>{t("Codec")}</span>
      <span className="text-center">{t("Link preview")}</span>
      <span className="sr-only">{t("Remove tier")}</span>
    </div>
  )
}

function LadderField({
  label,
  unit,
  value,
  min,
  max,
  error,
  className,
  hideLabelOnDesktop,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  error?: string
  className?: string
  hideLabelOnDesktop?: boolean
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <LadderFieldFrame
      id={id}
      label={label}
      className={className}
      hideLabelOnDesktop={hideLabelOnDesktop}
    >
      <InputGroup>
        <InputGroupInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isNaN(value) ? "" : value}
          aria-invalid={error ? true : undefined}
          className="pr-0 text-right font-mono tabular-nums"
          onChange={(event) => onChange(parseNumberInput(event.target.value))}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </LadderFieldFrame>
  )
}

function LadderCodecField({
  value,
  defaultCodec,
  error,
  className,
  hideLabelOnDesktop,
  onChange,
}: {
  value: VideoCodec | null
  defaultCodec: VideoCodec
  error?: string
  className?: string
  hideLabelOnDesktop?: boolean
  onChange: (codec: VideoCodec | null) => void
}) {
  const id = useId()
  return (
    <LadderFieldFrame
      id={id}
      label={t("Codec")}
      className={className}
      hideLabelOnDesktop={hideLabelOnDesktop}
    >
      <Select
        value={value ?? "default"}
        onValueChange={(next) => {
          if (next === "default") return onChange(null)
          const codec = TRANSCODE_VIDEO_CODECS.find((option) => option === next)
          if (codec) onChange(codec)
        }}
      >
        <SelectTrigger
          id={id}
          size="sm"
          aria-invalid={error ? true : undefined}
        >
          <SelectValue>{codecLabel(value, defaultCodec)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {codecLabel(null, defaultCodec)}
          </SelectItem>
          {TRANSCODE_VIDEO_CODECS.map((codec) => (
            <SelectItem key={codec} value={codec}>
              {VIDEO_CODEC_LABELS[codec]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </LadderFieldFrame>
  )
}

function LadderFieldFrame({
  id,
  label,
  className,
  hideLabelOnDesktop,
  children,
}: {
  id: string
  label: string
  className?: string
  hideLabelOnDesktop?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn(
          "text-foreground-muted text-xs font-medium",
          hideLabelOnDesktop && "sm:hidden",
        )}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function LadderPreviewRadio({
  name,
  checked,
  onChange,
}: {
  name: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      className="group flex cursor-pointer items-center justify-center rounded-md"
      title={checked ? t("Link preview") : t("Use as link preview")}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        className="peer sr-only"
        aria-label={checked ? t("Link preview") : t("Use as link preview")}
        onChange={onChange}
      />
      <span className="border-input text-foreground-muted peer-focus-visible:border-ring peer-focus-visible:ring-ring/50 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary group-hover:border-border-strong inline-flex h-7 min-w-14 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors peer-focus-visible:ring-3">
        {checked ? t("Preview") : t("Use")}
      </span>
    </label>
  )
}

function codecLabel(value: VideoCodec | null, defaultCodec: VideoCodec) {
  if (value) return VIDEO_CODEC_LABELS[value]
  return t("Default ({codec})", {
    codec: VIDEO_CODEC_LABELS[defaultCodec],
  })
}
