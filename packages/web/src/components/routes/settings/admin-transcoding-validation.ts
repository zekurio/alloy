import type {
  AdminRuntimeConfig,
  HardwareAcceleration,
  TranscodingCapabilities,
  VideoCodec,
} from "@alloy/api"
import { t } from "@alloy/i18n"

type TranscodingConfig = AdminRuntimeConfig["transcoding"]

// A tier keeps config-shaped numeric fields while edited; blank inputs become
// NaN so the row can flag "required" without ever leaving a config-shaped hole.
// `codec` is null when the tier follows the global default codec.
export type LadderTier = {
  id: string
  height: number
  maxFps: number
  maxrateKbps: number
  codec: VideoCodec | null
  og: boolean
}

export type TranscodingForm = {
  videoCodec: VideoCodec
  hardwareAcceleration: HardwareAcceleration
  vaapiDevice: string
  quality: number
  audioBitrateKbps: number
  tiers: LadderTier[]
}

export const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = {
  h264: t("H.264 (AVC)"),
  hevc: t("HEVC (H.265)"),
  av1: t("AV1"),
}

export const HARDWARE_ACCELERATION_LABELS: Record<
  HardwareAcceleration,
  string
> = {
  none: t("Software (CPU)"),
  nvenc: t("NVIDIA NVENC"),
  qsv: t("Intel Quick Sync"),
  vaapi: t("VA-API"),
  videotoolbox: t("Apple VideoToolbox"),
}

export const AUDIO_BITRATES = [64, 96, 128, 160, 192, 256, 320] as const

const COMMON_TIER_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]

export function firstTierError(row: RowErrors): string | undefined {
  return row.height ?? row.maxFps ?? row.maxrateKbps ?? row.codec
}

export function formFromConfig(
  transcoding: TranscodingConfig,
): TranscodingForm {
  return {
    videoCodec: transcoding.videoCodec,
    hardwareAcceleration: transcoding.hardwareAcceleration,
    vaapiDevice: transcoding.vaapiDevice,
    quality: transcoding.quality,
    audioBitrateKbps: transcoding.audioBitrateKbps,
    tiers: transcoding.tiers.map((tier) => ({
      id: crypto.randomUUID(),
      height: tier.height,
      maxFps: tier.maxFps,
      maxrateKbps: tier.maxrateKbps,
      codec: tier.codec ?? null,
      og: tier.og ?? false,
    })),
  }
}

/**
 * Index of the tier that powers link previews: the flagged one, or the
 * tallest tier when none is flagged. -1 only when no tier has a valid height.
 */
export function effectiveOgTierIndex(tiers: readonly LadderTier[]): number {
  const flagged = tiers.findIndex((tier) => tier.og)
  if (flagged !== -1) return flagged
  return tiers.reduce((best, tier, index) => {
    if (!Number.isFinite(tier.height)) return best
    if (best === -1 || tier.height > tiers[best].height) return index
    return best
  }, -1)
}

/** Effective codec of the link preview tier (flagged, or tallest). */
export function compatTierCodec(form: TranscodingForm): VideoCodec {
  const index = effectiveOgTierIndex(form.tiers)
  return (index === -1 ? null : form.tiers[index].codec) ?? form.videoCodec
}

export function ffmpegBadgeLabel(
  capabilities: TranscodingCapabilities,
): string {
  const versionNumber = capabilities.version
    ? /^ffmpeg version (\S+)/i
        .exec(capabilities.version)?.[1]
        ?.replace(/-jellyfin$/i, "")
    : null
  const flavor = capabilities.jellyfin ? t("Jellyfin FFmpeg") : t("FFmpeg")
  return versionNumber ? `${flavor} ${versionNumber}` : flavor
}

export function formsEqual(
  form: TranscodingForm,
  saved: TranscodingConfig,
): boolean {
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
      tier.maxrateKbps === savedTier.maxrateKbps &&
      tier.codec === (savedTier.codec ?? null) &&
      tier.og === (savedTier.og ?? false)
    )
  })
}

export function findProbe(
  capabilities: TranscodingCapabilities,
  codec: VideoCodec,
  acceleration: HardwareAcceleration,
) {
  return capabilities.encoders.find(
    (probe) => probe.codec === codec && probe.acceleration === acceleration,
  )
}

type RowErrors = {
  height?: string
  maxFps?: string
  maxrateKbps?: string
  codec?: string
}

export function validateForm(
  form: TranscodingForm,
  capabilities: TranscodingCapabilities | null,
) {
  const rows = form.tiers.map((tier) => validateTier(tier, form, capabilities))

  const tierKey = (tier: LadderTier) =>
    `${tier.height}:${tier.maxFps}:${tier.codec ?? "default"}`
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const tier of form.tiers) {
    if (!Number.isFinite(tier.height) || !Number.isFinite(tier.maxFps)) continue
    if (seen.has(tierKey(tier))) duplicates.add(tierKey(tier))
    seen.add(tierKey(tier))
  }
  form.tiers.forEach((tier, index) => {
    if (duplicates.has(tierKey(tier)) && !rows[index].height) {
      rows[index].height = t("Tiers must differ in height, max FPS, or codec.")
    }
  })

  const countMessage =
    form.tiers.length < 1 || form.tiers.length > 6
      ? t("Keep between 1 and 6 rendition tiers.")
      : null
  const duplicateMessage =
    duplicates.size > 0
      ? t("Tiers must differ in height, max FPS, or codec.")
      : null

  const accelerationMessage = validateAcceleration(form, capabilities)
  const vaapiDeviceMessage =
    form.hardwareAcceleration === "vaapi" && form.vaapiDevice.trim() === ""
      ? t("Enter a VA-API render node path.")
      : null

  const rowsValid = rows.every(
    (row) => !row.height && !row.maxFps && !row.maxrateKbps && !row.codec,
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

function validateTier(
  tier: LadderTier,
  form: TranscodingForm,
  capabilities: TranscodingCapabilities | null,
): RowErrors {
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
  // A tier codec override must work with the globally selected backend; the
  // global codec is already covered by validateAcceleration.
  if (tier.codec && form.hardwareAcceleration !== "none" && capabilities) {
    const probe = findProbe(capabilities, tier.codec, form.hardwareAcceleration)
    if (!probe || probe.status !== "ok") {
      errors.codec = t(
        "{codec} isn't available with {backend} on this server.",
        {
          codec: VIDEO_CODEC_LABELS[tier.codec],
          backend: HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
        },
      )
    }
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

export function parseNumberInput(value: string): number {
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

export function suggestMaxrateKbps(height: number): number {
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

export function nextTierHeight(tiers: readonly LadderTier[]): number {
  const used = new Set(tiers.map((tier) => tier.height))
  return COMMON_TIER_HEIGHTS.find((height) => !used.has(height)) ?? 720
}
