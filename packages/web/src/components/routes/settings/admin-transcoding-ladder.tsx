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
import type { ReactNode } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

import {
  effectiveOgTierIndex,
  firstTierError,
  newTierId,
  nextTierHeight,
  parseNumberInput,
  sortTiers,
  suggestMaxrateKbps,
  VIDEO_CODEC_LABELS,
} from "./admin-transcoding-validation"
import type {
  LadderTier,
  TranscodingForm,
  validateForm,
} from "./admin-transcoding-validation"

// The layout follows the panel's width, not the viewport's: next to the
// settings sidebar, a tablet-sized window leaves the panel narrower than the
// table. All seven columns fit from 49rem up.
const LADDER_TABLE_CLASS =
  "@[49rem]:grid-cols-[7rem_6rem_5rem_7rem_minmax(10rem,1fr)_5.5rem_2rem] @[49rem]:items-center"

export function TranscodingLadder({
  values,
  validation,
  setTiers,
  reset,
}: {
  values: TranscodingForm
  validation: ReturnType<typeof validateForm>
  setTiers: (update: (tiers: LadderTier[]) => LadderTier[]) => void
  /** Shown beside Add tier, such as a reset-to-default button. */
  reset?: ReactNode
}) {
  const tierNames = useMemo(
    () =>
      deriveRenditionNames(
        values.tiers.map((tier) => ({
          height: tier.height,
          fps: tier.maxFps,
          codec: tier.codec ?? values.videoCodec,
        })),
      ),
    [values.tiers, values.videoCodec],
  )
  const ogIndex = effectiveOgTierIndex(values.tiers)
  const ogRadioName = useId()

  function addTier() {
    setTiers((tiers) => {
      if (tiers.length >= 6) return tiers
      const height = nextTierHeight(tiers)
      const tier: LadderTier = {
        id: newTierId(),
        height,
        maxFps: 60,
        maxrateKbps: suggestMaxrateKbps(height),
        codec: null,
        og: false,
      }
      return sortTiers([...tiers, tier])
    })
  }

  function updateTier(index: number, patch: Partial<LadderTier>) {
    setTiers((tiers) =>
      tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier,
      ),
    )
  }

  function removeTier(index: number) {
    setTiers((tiers) =>
      tiers.length <= 1
        ? tiers
        : tiers.filter((_, tierIndex) => tierIndex !== index),
    )
  }

  function setOgTier(index: number) {
    setTiers((tiers) =>
      tiers.map((tier, tierIndex) => ({ ...tier, og: tierIndex === index })),
    )
  }

  return (
    <SettingsSubsection
      id="ladder"
      title={t("Rendition ladder")}
      description={t(
        "Every upload is encoded into these renditions. Tiers above the source resolution are skipped, and the selected link preview tier powers social embeds.",
      )}
      action={
        <div className="flex items-center gap-2">
          {reset}
          <Button
            type="button"
            variant="secondary"
            onClick={addTier}
            disabled={values.tiers.length >= 6}
            className="flex-1 @xl:flex-none"
          >
            <PlusIcon />
            {t("Add tier")}
          </Button>
        </div>
      }
    >
      <div className="border-border @container overflow-hidden rounded-lg border">
        <LadderHeader />
        <div className="divide-border divide-y">
          {values.tiers.map((tier, index) => (
            // Below the table width a tier is a card: its name and row
            // controls on one line, then the fields. A phone gives the codec
            // its own line; a wider panel fits it beside the numbers.
            <div
              key={tier.id}
              className={cn(
                "grid grid-cols-[1fr_1fr_1.25fr] gap-3 p-3 @xl:grid-cols-[1fr_1fr_1.25fr_2.25fr]",
                LADDER_TABLE_CLASS,
              )}
            >
              <span className="bg-muted text-foreground-muted @[49rem]:text-2xs col-start-1 row-start-1 w-fit self-center rounded px-1.5 py-0.5 font-mono text-xs">
                {Number.isFinite(tier.height) ? tierNames[index] : "–"}
              </span>
              <LadderField
                label={t("Height")}
                unit={t("px")}
                min={144}
                max={4320}
                value={tier.height}
                error={validation.rows[index]?.height}
                onChange={(height) => updateTier(index, { height })}
              />
              <LadderField
                label={t("Max FPS")}
                unit={t("fps")}
                min={1}
                max={240}
                value={tier.maxFps}
                error={validation.rows[index]?.maxFps}
                onChange={(maxFps) => updateTier(index, { maxFps })}
              />
              <LadderField
                label={t("Max bitrate")}
                unit={t("kbps")}
                min={100}
                max={100000}
                value={tier.maxrateKbps}
                error={validation.rows[index]?.maxrateKbps}
                onChange={(maxrateKbps) => updateTier(index, { maxrateKbps })}
              />
              <LadderCodecField
                value={tier.codec}
                defaultCodec={values.videoCodec}
                error={validation.rows[index]?.codec}
                className="col-span-full @xl:col-span-1"
                onChange={(codec) => updateTier(index, { codec })}
              />
              {/* On the name's line in a card; the last two cells of a table row. */}
              <div className="col-span-2 col-start-2 row-start-1 flex items-center justify-end gap-2 @xl:col-span-3 @[49rem]:contents">
                <LadderPreviewRadio
                  name={ogRadioName}
                  checked={index === ogIndex}
                  onChange={() => setOgTier(index)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeTier(index)}
                  disabled={values.tiers.length <= 1}
                  aria-label={t("Remove tier")}
                  className="-mr-2.5 @[49rem]:mr-0"
                >
                  <Trash2Icon />
                </Button>
              </div>
              {firstTierError(validation.rows[index]) ? (
                <p className="text-destructive text-2xs col-span-full">
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
    </SettingsSubsection>
  )
}

function LadderHeader() {
  return (
    <div
      className={cn(
        "bg-muted/30 text-foreground-muted hidden gap-3 px-3 py-2 text-xs font-medium @[49rem]:grid",
        LADDER_TABLE_CLASS,
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
  onChange,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  error?: string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <LadderFieldFrame id={id} label={label}>
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
  onChange,
}: {
  value: VideoCodec | null
  defaultCodec: VideoCodec
  error?: string
  className?: string
  onChange: (codec: VideoCodec | null) => void
}) {
  const id = useId()
  return (
    <LadderFieldFrame id={id} label={t("Codec")} className={className}>
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
          className="w-full @[49rem]:w-fit"
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

/** Labels a field in a card. The table's header row names the column instead. */
function LadderFieldFrame({
  id,
  label,
  className,
  children,
}: {
  id: string
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-foreground-muted truncate text-xs font-medium @[49rem]:hidden"
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
      className="group flex cursor-pointer items-center justify-center gap-2 rounded-md py-2 @[49rem]:py-0"
      title={checked ? t("Link preview") : t("Use as link preview")}
    >
      <span className="text-foreground-muted text-xs font-medium @[49rem]:hidden">
        {t("Link preview")}
      </span>
      <input
        type="radio"
        name={name}
        checked={checked}
        className="peer sr-only"
        aria-label={checked ? t("Link preview") : t("Use as link preview")}
        onChange={onChange}
      />
      <span className="border-input text-foreground-muted after:bg-accent group-hover:border-border-strong peer-focus-visible:border-ring peer-focus-visible:ring-ring/50 peer-checked:border-accent-border relative inline-flex size-4 items-center justify-center rounded-full border transition-colors peer-focus-visible:ring-3 after:size-2 after:rounded-full after:opacity-0 after:transition-opacity after:content-[''] peer-checked:after:opacity-100"></span>
    </label>
  )
}

function codecLabel(value: VideoCodec | null, defaultCodec: VideoCodec) {
  if (value) return VIDEO_CODEC_LABELS[value]
  return t("Default ({codec})", {
    codec: VIDEO_CODEC_LABELS[defaultCodec],
  })
}
