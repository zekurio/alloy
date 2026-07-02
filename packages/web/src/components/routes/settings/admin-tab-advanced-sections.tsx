import {
  type AdminRuntimeConfig,
  HARDWARE_ACCELERATIONS,
  type HardwareAcceleration,
  type TranscodingCapabilities,
  TRANSCODE_VIDEO_CODECS,
  type VideoCodec,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@alloy/ui/components/input-group"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import {
  adminKeys,
  adminTranscodingCapabilitiesQueryOptions,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

type AdminConfigSetter = Dispatch<SetStateAction<AdminRuntimeConfig | null>>

type TranscodingConfig = AdminRuntimeConfig["transcoding"]

// A tier stays a plain numeric shape while edited; blank inputs become NaN so
// the row can flag "required" without ever leaving a config-shaped hole.
type LadderTier = { height: number; maxFps: number; maxrateKbps: number }

type TranscodingForm = {
  videoCodec: VideoCodec
  hardwareAcceleration: HardwareAcceleration
  vaapiDevice: string
  quality: number
  audioBitrateKbps: number
  tiers: LadderTier[]
}

const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = {
  h264: t("H.264 (AVC)"),
  hevc: t("HEVC (H.265)"),
  av1: t("AV1"),
}

const HARDWARE_ACCELERATION_LABELS: Record<HardwareAcceleration, string> = {
  none: t("Software (CPU)"),
  nvenc: t("NVIDIA NVENC"),
  qsv: t("Intel Quick Sync"),
  vaapi: t("VA-API"),
  videotoolbox: t("Apple VideoToolbox"),
}

const QUALITY_HINTS: Record<VideoCodec, string> = {
  h264: t("For H.264, 18–28 is a good range."),
  hevc: t("For HEVC, 18–28 is a good range."),
  av1: t("AV1 stays clean at higher values; 24–32 is typical."),
}

const AUDIO_BITRATES = [64, 96, 128, 160, 192, 256, 320] as const

const COMMON_TIER_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]

export function TranscodingSettingsContent({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: AdminConfigSetter
}) {
  const saved = config.transcoding
  const [form, setForm] = useState<TranscodingForm>(() => formFromConfig(saved))
  const [saving, setSaving] = useState(false)
  const [reEncodePending, setReEncodePending] = useState(false)
  const [redetecting, setRedetecting] = useState(false)
  const queryClient = useQueryClient()
  const capabilitiesQuery = useQuery(adminTranscodingCapabilitiesQueryOptions())
  const capabilities = capabilitiesQuery.data ?? null

  // The saved config is the source of truth: reset the draft whenever the
  // server hands back a new one (after a save it may be normalized/clamped).
  useEffect(() => {
    setForm(formFromConfig(saved))
  }, [saved])

  const validation = useMemo(
    () => validateForm(form, capabilities),
    [form, capabilities],
  )
  const dirty = useMemo(() => !formsEqual(form, saved), [form, saved])
  const selectedProbe =
    form.hardwareAcceleration === "none" || !capabilities
      ? null
      : findProbe(capabilities, form.videoCodec, form.hardwareAcceleration)

  async function save() {
    if (saving || !dirty) return
    if (!validation.valid) {
      if (validation.message) toast.error(validation.message)
      return
    }
    setSaving(true)
    try {
      const updated = await api.admin.updateTranscodingConfig({
        videoCodec: form.videoCodec,
        hardwareAcceleration: form.hardwareAcceleration,
        vaapiDevice: form.vaapiDevice.trim(),
        quality: form.quality,
        audioBitrateKbps: form.audioBitrateKbps,
        tiers: form.tiers,
      })
      setConfig(updated)
      toast.success(t("Transcoding settings saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save transcoding settings")))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(formFromConfig(saved))
  }

  async function reDetect() {
    if (redetecting) return
    setRedetecting(true)
    try {
      const next = await api.admin.fetchTranscodingCapabilities({
        refresh: true,
      })
      queryClient.setQueryData(adminKeys.transcodingCapabilities(), next)
      toast.success(t("Encoder detection refreshed"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't detect encoders")))
    } finally {
      setRedetecting(false)
    }
  }

  async function reEncodeAll() {
    if (reEncodePending) return
    setReEncodePending(true)
    try {
      const result = await api.admin.reEncodeAllClips()
      toast.success(
        result.hasMore
          ? t("Re-encode started for {count} clips; run again for the rest.", {
              count: result.enqueued,
            })
          : t("Re-encode started for {count} clips.", {
              count: result.enqueued,
            }),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't start re-encode")))
    } finally {
      setReEncodePending(false)
    }
  }

  const inSettingsDialog = useSettingsSaveBar({ dirty, saving, save, discard })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-6 py-0">
        <p className="text-foreground-dim text-xs">
          {t(
            "How the server transcodes new uploads: video codec, optional GPU encoding, quality, audio, and the ladder of renditions used for adaptive playback.",
          )}
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              {t("Codec & encoding")}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              {capabilities?.jellyfin ? (
                <Badge variant="accent">{t("Jellyfin")}</Badge>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reDetect}
                disabled={redetecting || capabilitiesQuery.isLoading}
                className="shrink-0"
              >
                <RefreshCwIcon className={redetecting ? "animate-spin" : ""} />
                {redetecting ? t("Detecting...") : t("Re-detect")}
              </Button>
            </div>
          </div>

          <p className="text-foreground-dim -mt-2 text-xs">
            {capabilitiesQuery.isLoading
              ? t("Detecting encoders...")
              : (capabilities?.version ?? t("ffmpeg not detected"))}
          </p>

          <SettingRow
            title={t("Video codec")}
            description={t("Codec used to encode every rendition.")}
            htmlFor="transcoding-codec"
            align="start"
          >
            <Select
              value={form.videoCodec}
              onValueChange={(value) => {
                const codec = TRANSCODE_VIDEO_CODECS.find(
                  (option) => option === value,
                )
                if (codec) setForm((prev) => ({ ...prev, videoCodec: codec }))
              }}
            >
              <SelectTrigger id="transcoding-codec" size="sm" className="w-48">
                <SelectValue>{VIDEO_CODEC_LABELS[form.videoCodec]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {TRANSCODE_VIDEO_CODECS.map((codec) => (
                  <SelectItem key={codec} value={codec}>
                    {VIDEO_CODEC_LABELS[codec]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {form.videoCodec !== "h264" ? (
            <TranscodingNotice tone="warning">
              {t(
                "Social embeds (Discord, Slack, X) need H.264 video. With HEVC or AV1, the server stops adding video embed tags, so shared links fall back to a thumbnail card instead of an inline player.",
              )}
            </TranscodingNotice>
          ) : null}

          <SettingRow
            title={t("Hardware acceleration")}
            description={t(
              "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.",
            )}
            htmlFor="transcoding-hwaccel"
            align="start"
          >
            <Select
              value={form.hardwareAcceleration}
              onValueChange={(value) => {
                const accel = HARDWARE_ACCELERATIONS.find(
                  (option) => option === value,
                )
                if (accel) {
                  setForm((prev) => ({ ...prev, hardwareAcceleration: accel }))
                }
              }}
            >
              <SelectTrigger
                id="transcoding-hwaccel"
                size="sm"
                className="w-56"
              >
                <SelectValue>
                  {HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {HARDWARE_ACCELERATIONS.map((accel) => {
                  const probe =
                    accel === "none" || !capabilities
                      ? null
                      : findProbe(capabilities, form.videoCodec, accel)
                  const unavailable =
                    accel !== "none" &&
                    capabilities !== null &&
                    probe?.status !== "ok"
                  return (
                    <SelectItem
                      key={accel}
                      value={accel}
                      disabled={unavailable}
                    >
                      {HARDWARE_ACCELERATION_LABELS[accel]}
                      {unavailable ? ` ${t("(unavailable)")}` : ""}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </SettingRow>

          {selectedProbe && selectedProbe.status !== "ok" ? (
            <TranscodingNotice tone="danger">
              {selectedProbe.status === "missing"
                ? t(
                    "This ffmpeg build has no {backend} encoder for {codec}. Pick another backend or install jellyfin-ffmpeg.",
                    {
                      backend:
                        HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
                      codec: VIDEO_CODEC_LABELS[form.videoCodec],
                    },
                  )
                : t(
                    "The {backend} encoder for {codec} failed its test on this server. Pick another backend or check the GPU drivers.",
                    {
                      backend:
                        HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
                      codec: VIDEO_CODEC_LABELS[form.videoCodec],
                    },
                  )}
              {selectedProbe.error ? (
                <span className="text-foreground-muted text-2xs mt-1 block font-mono break-words">
                  {selectedProbe.error}
                </span>
              ) : null}
            </TranscodingNotice>
          ) : null}

          {form.hardwareAcceleration === "vaapi" ? (
            <SettingRow
              title={t("VA-API device")}
              description={t(
                "Render node passed to ffmpeg for VA-API encoding.",
              )}
              htmlFor="transcoding-vaapi-device"
              align="start"
            >
              <div className="flex w-56 flex-col gap-1.5">
                <Input
                  id="transcoding-vaapi-device"
                  value={form.vaapiDevice}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      vaapiDevice: event.target.value,
                    }))
                  }
                  placeholder="/dev/dri/renderD128"
                  aria-invalid={
                    validation.vaapiDeviceMessage ? true : undefined
                  }
                />
                {validation.vaapiDeviceMessage ? (
                  <p className="text-destructive text-2xs">
                    {validation.vaapiDeviceMessage}
                  </p>
                ) : null}
              </div>
            </SettingRow>
          ) : null}
        </div>

        <div className="border-border flex flex-col gap-4 border-t pt-6">
          <span className="text-sm font-semibold">{t("Quality & audio")}</span>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="transcoding-quality"
                className="text-sm font-medium"
              >
                {t("Constant quality")}
              </label>
              <span className="font-mono text-sm tabular-nums">
                {Number.isNaN(form.quality) ? "–" : form.quality}
              </span>
            </div>
            <Slider
              id="transcoding-quality"
              aria-label={t("Constant quality")}
              min={10}
              max={51}
              value={form.quality}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  quality: typeof value === "number" ? value : (value[0] ?? 22),
                }))
              }
            />
            <p className="text-foreground-dim text-xs">
              {t("Lower values keep more detail but produce larger files.")}{" "}
              {QUALITY_HINTS[form.videoCodec]}
            </p>
          </div>

          <SettingRow
            title={t("Audio bitrate")}
            description={t("Stereo AAC bitrate applied to every rendition.")}
            htmlFor="transcoding-audio"
            align="start"
          >
            <Select
              value={String(form.audioBitrateKbps)}
              onValueChange={(value) => {
                const kbps = AUDIO_BITRATES.find(
                  (option) => String(option) === value,
                )
                if (kbps) {
                  setForm((prev) => ({ ...prev, audioBitrateKbps: kbps }))
                }
              }}
            >
              <SelectTrigger id="transcoding-audio" size="sm" className="w-48">
                <SelectValue>
                  {t("{kbps} kbps", { kbps: form.audioBitrateKbps })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {AUDIO_BITRATES.map((kbps) => (
                  <SelectItem key={kbps} value={String(kbps)}>
                    {t("{kbps} kbps", { kbps })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>

        <div className="border-border flex flex-col gap-3 border-t pt-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              {t("Rendition ladder")}
            </span>
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
              "Every upload is encoded into these renditions. Tiers above the source resolution are skipped, and the tallest one also powers link previews.",
            )}
          </p>

          <div className="flex flex-col gap-2">
            {form.tiers.map((tier, index) => (
              <div
                key={index}
                className="border-border flex flex-wrap items-start gap-3 rounded-lg border p-3"
              >
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeTier(index)}
                  disabled={form.tiers.length <= 1}
                  aria-label={t("Remove tier")}
                  className="mt-6 ml-auto shrink-0"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>

          {validation.formMessage ? (
            <TranscodingNotice tone="danger">
              {validation.formMessage}
            </TranscodingNotice>
          ) : null}
        </div>

        <div className="border-border flex items-start justify-between gap-4 border-t pt-6">
          <p className="text-foreground-dim text-xs">
            {t(
              "Changes apply to new uploads. Re-encode existing clips to regenerate their renditions with the current tiers.",
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reEncodeAll}
            disabled={reEncodePending}
            className="shrink-0"
          >
            <RefreshCwIcon />
            {reEncodePending ? t("Starting...") : t("Re-encode clips")}
          </Button>
        </div>
      </SectionContent>
      {!inSettingsDialog && (
        <SectionFooter>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={saving || !dirty}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              disabled={saving || !dirty || !validation.valid}
            >
              <SaveIcon />
              {saving ? t("Saving...") : t("Save")}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )

  function addTier() {
    setForm((prev) => {
      if (prev.tiers.length >= 6) return prev
      const height = nextTierHeight(prev.tiers)
      const tier: LadderTier = {
        height,
        maxFps: 60,
        maxrateKbps: suggestMaxrateKbps(height),
      }
      return {
        ...prev,
        tiers: [...prev.tiers, tier].sort((a, b) => b.height - a.height),
      }
    })
  }

  function updateTier(index: number, patch: Partial<LadderTier>) {
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier, i) =>
        i === index ? { ...tier, ...patch } : tier,
      ),
    }))
  }

  function removeTier(index: number) {
    setForm((prev) => {
      if (prev.tiers.length <= 1) return prev
      return { ...prev, tiers: prev.tiers.filter((_, i) => i !== index) }
    })
  }
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
    <div className="flex min-w-[7rem] flex-1 flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-foreground-muted text-2xs font-medium tracking-[0.06em] uppercase"
      >
        {label}
      </label>
      <InputGroup>
        <InputGroupInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isNaN(value) ? "" : value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(parseNumberInput(event.target.value))}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {error ? <p className="text-destructive text-2xs">{error}</p> : null}
    </div>
  )
}

function TranscodingNotice({
  tone,
  children,
}: {
  tone: "warning" | "danger"
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "text-foreground-dim flex gap-2 rounded-lg border p-3 text-xs leading-relaxed",
        tone === "warning"
          ? "border-warning/30 bg-warning/5"
          : "border-destructive/30 bg-destructive/5",
      )}
    >
      <TriangleAlertIcon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "warning" ? "text-warning" : "text-destructive",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function formFromConfig(transcoding: TranscodingConfig): TranscodingForm {
  return {
    videoCodec: transcoding.videoCodec,
    hardwareAcceleration: transcoding.hardwareAcceleration,
    vaapiDevice: transcoding.vaapiDevice,
    quality: transcoding.quality,
    audioBitrateKbps: transcoding.audioBitrateKbps,
    tiers: transcoding.tiers.map((tier) => ({
      height: tier.height,
      maxFps: tier.maxFps,
      maxrateKbps: tier.maxrateKbps,
    })),
  }
}

function formsEqual(form: TranscodingForm, saved: TranscodingConfig): boolean {
  if (form.videoCodec !== saved.videoCodec) return false
  if (form.hardwareAcceleration !== saved.hardwareAcceleration) return false
  if (form.vaapiDevice !== saved.vaapiDevice) return false
  if (form.quality !== saved.quality) return false
  if (form.audioBitrateKbps !== saved.audioBitrateKbps) return false
  if (form.tiers.length !== saved.tiers.length) return false
  return form.tiers.every((tier, index) => {
    const savedTier = saved.tiers[index]
    return (
      tier.height === savedTier.height &&
      tier.maxFps === savedTier.maxFps &&
      tier.maxrateKbps === savedTier.maxrateKbps
    )
  })
}

function findProbe(
  capabilities: TranscodingCapabilities,
  codec: VideoCodec,
  acceleration: HardwareAcceleration,
) {
  return capabilities.encoders.find(
    (probe) => probe.codec === codec && probe.acceleration === acceleration,
  )
}

type RowErrors = { height?: string; maxFps?: string; maxrateKbps?: string }

function validateForm(
  form: TranscodingForm,
  capabilities: TranscodingCapabilities | null,
) {
  const rows = form.tiers.map((tier) => validateTier(tier))

  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const tier of form.tiers) {
    if (!Number.isFinite(tier.height)) continue
    if (seen.has(tier.height)) duplicates.add(tier.height)
    seen.add(tier.height)
  }
  form.tiers.forEach((tier, index) => {
    if (duplicates.has(tier.height) && !rows[index].height) {
      rows[index].height = t("Tier heights must be unique.")
    }
  })

  const countMessage =
    form.tiers.length < 1 || form.tiers.length > 6
      ? t("Keep between 1 and 6 rendition tiers.")
      : null
  const duplicateMessage =
    duplicates.size > 0 ? t("Every tier needs a unique height.") : null

  const accelerationMessage = validateAcceleration(form, capabilities)
  const vaapiDeviceMessage =
    form.hardwareAcceleration === "vaapi" && form.vaapiDevice.trim() === ""
      ? t("Enter a VA-API render node path.")
      : null

  const rowsValid = rows.every(
    (row) => !row.height && !row.maxFps && !row.maxrateKbps,
  )
  const valid =
    rowsValid &&
    !countMessage &&
    !duplicateMessage &&
    !accelerationMessage &&
    !vaapiDeviceMessage
  const message =
    accelerationMessage ??
    vaapiDeviceMessage ??
    countMessage ??
    duplicateMessage ??
    firstRowMessage(rows)

  return {
    rows,
    formMessage: countMessage ?? duplicateMessage,
    vaapiDeviceMessage,
    valid,
    message,
  }
}

function validateTier(tier: LadderTier): RowErrors {
  const errors: RowErrors = {}
  if (!isIntInRange(tier.height, 144, 4320) || tier.height % 2 !== 0) {
    errors.height = t("Height must be an even number from 144 to 4320.")
  }
  if (!isIntInRange(tier.maxFps, 1, 240)) {
    errors.maxFps = t("Max FPS must be from 1 to 240.")
  }
  if (!isIntInRange(tier.maxrateKbps, 100, 100000)) {
    errors.maxrateKbps = t("Max bitrate must be from 100 to 100000 kbps.")
  }
  return errors
}

function validateAcceleration(
  form: TranscodingForm,
  capabilities: TranscodingCapabilities | null,
): string | null {
  if (form.hardwareAcceleration === "none" || !capabilities) return null
  const probe = findProbe(
    capabilities,
    form.videoCodec,
    form.hardwareAcceleration,
  )
  if (probe && probe.status === "ok") return null
  return t(
    "The selected {backend} encoder isn't available for {codec} on this server.",
    {
      backend: HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
      codec: VIDEO_CODEC_LABELS[form.videoCodec],
    },
  )
}

function firstRowMessage(rows: RowErrors[]): string | null {
  for (const row of rows) {
    const message = row.height ?? row.maxFps ?? row.maxrateKbps
    if (message) return message
  }
  return null
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

function parseNumberInput(value: string): number {
  if (value.trim() === "") return Number.NaN
  return Number(value)
}

// Suggested per-height maxrate for a freshly added tier: anchored to the common
// ladder points and linearly interpolated (or extrapolated) elsewhere.
const MAXRATE_ANCHORS = [
  { height: 480, kbps: 2500 },
  { height: 720, kbps: 5000 },
  { height: 1080, kbps: 8000 },
  { height: 1440, kbps: 12000 },
  { height: 2160, kbps: 20000 },
]

function suggestMaxrateKbps(height: number): number {
  const first = MAXRATE_ANCHORS[0]
  if (height <= first.height) {
    return clampMaxrate(Math.round((height / first.height) * first.kbps))
  }
  const upperIndex = MAXRATE_ANCHORS.findIndex(
    (anchor) => anchor.height >= height,
  )
  if (upperIndex === -1) {
    const last = MAXRATE_ANCHORS[MAXRATE_ANCHORS.length - 1]
    const prev = MAXRATE_ANCHORS[MAXRATE_ANCHORS.length - 2]
    const slope = (last.kbps - prev.kbps) / (last.height - prev.height)
    return clampMaxrate(Math.round(last.kbps + (height - last.height) * slope))
  }
  const upper = MAXRATE_ANCHORS[upperIndex]
  const lower = MAXRATE_ANCHORS[upperIndex - 1]
  const ratio = (height - lower.height) / (upper.height - lower.height)
  return clampMaxrate(
    Math.round(lower.kbps + ratio * (upper.kbps - lower.kbps)),
  )
}

function clampMaxrate(kbps: number): number {
  return Math.min(100000, Math.max(100, kbps))
}

function nextTierHeight(tiers: LadderTier[]): number {
  const used = new Set(tiers.map((tier) => tier.height))
  return COMMON_TIER_HEIGHTS.find((height) => !used.has(height)) ?? 720
}

export function AppearanceSettingsContent({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: AdminConfigSetter
}) {
  const [enabledPending, setEnabledPending] = useState(false)
  const [treatmentPending, setTreatmentPending] = useState(false)
  const splash = config.appearance.loginSplash
  const [draftBlurPx, setDraftBlurPx] = useState(splash.blurPx)
  const [draftDarkenOpacity, setDraftDarkenOpacity] = useState(
    splash.darkenOpacity,
  )
  const previewSplash = useMemo(
    () => ({
      ...splash,
      blurPx: draftBlurPx,
      darkenOpacity: draftDarkenOpacity,
    }),
    [draftBlurPx, draftDarkenOpacity, splash],
  )
  const treatmentChanged =
    draftBlurPx !== splash.blurPx || draftDarkenOpacity !== splash.darkenOpacity

  useEffect(() => {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }, [splash.blurPx, splash.darkenOpacity])

  async function updateSplashEnabled(next: boolean) {
    if (enabledPending) return
    setEnabledPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: { enabled: next },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(
        next ? t("Login backdrop enabled") : t("Login backdrop disabled"),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update backdrop")))
    } finally {
      setEnabledPending(false)
    }
  }

  function cancelTreatment() {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }

  async function saveTreatment() {
    if (treatmentPending || !treatmentChanged) return
    setTreatmentPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: {
          blurPx: draftBlurPx,
          darkenOpacity: draftDarkenOpacity,
        },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("Login backdrop appearance saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save backdrop appearance")))
    } finally {
      setTreatmentPending(false)
    }
  }

  // The enabled switch applies immediately; only the blur/darkening treatment
  // is deferred, so that's what goes through the unified save bar.
  const inSettingsDialog = useSettingsSaveBar({
    dirty: treatmentChanged,
    saving: treatmentPending,
    save: saveTreatment,
    discard: cancelTreatment,
  })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-4 py-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("Login backdrop")}</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {t(
                "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.",
              )}
            </p>
          </div>
          <Switch
            checked={splash.enabled}
            onCheckedChange={updateSplashEnabled}
            disabled={enabledPending}
            className="shrink-0"
          />
        </div>

        <LoginAppearancePreview
          config={config}
          splash={previewSplash}
          blurPx={draftBlurPx}
          darkenOpacity={draftDarkenOpacity}
          controlsDisabled={treatmentPending}
          onBlurPxChange={setDraftBlurPx}
          onDarkenOpacityChange={setDraftDarkenOpacity}
        />
      </SectionContent>
      {!inSettingsDialog && (
        <SectionFooter>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelTreatment}
              disabled={treatmentPending || !treatmentChanged}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={saveTreatment}
              disabled={treatmentPending || !treatmentChanged}
            >
              <SaveIcon />
              {treatmentPending ? t("Saving...") : t("Save")}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}
