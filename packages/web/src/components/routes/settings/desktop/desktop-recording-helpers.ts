import type {
  RecordingAudioDeviceKind,
  RecordingAudioMode,
  RecordingBitrate,
  RecordingBufferStorage,
  RecordingCodec,
  RecordingEncoder,
  RecordingFrameRate,
  RecordingQualityProfile,
  RecordingQualitySettings,
  RecordingResolution,
  RecordingSettings,
} from "@alloy/contracts"
import { RECORDING_QUALITY_PRESETS as CONTRACT_RECORDING_QUALITY_PRESETS } from "@alloy/contracts"
import { getRuntimeLocale, localeToLanguageTag, t as tx } from "@alloy/i18n"

export const ENCODER_LABELS: Record<RecordingEncoder, string> = {
  hardware: tx("GPU"),
  software: tx("CPU"),
}

export const CODEC_LABELS: Record<RecordingCodec, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
}

export const RESOLUTION_LABELS: Record<RecordingResolution, string> = {
  source: tx("Source"),
  "720p": "720p",
  "1080p": "1080p",
  "1440p": "1440p",
  "2160p": "4K",
}

export function bitrateLabel(value: RecordingBitrate): string {
  return value === "auto" ? tx("Auto") : `${value}M`
}

export const AUDIO_MODE_LABELS: Record<RecordingAudioMode, string> = {
  devices: tx("Devices"),
  applications: tx("Applications"),
}

export const AUDIO_DEVICE_KIND_LABELS: Record<
  RecordingAudioDeviceKind,
  string
> = {
  output: tx("Output"),
  input: tx("Input"),
}

export const BUFFER_STORAGE_LABELS: Record<RecordingBufferStorage, string> = {
  memory: tx("Memory"),
  disk: tx("Disk"),
}

export function gpuLabel(value: string): string {
  if (value === "auto") return tx("Auto")

  const match = /^adapter:(\d+)(?::(.+))?$/.exec(value)
  if (!match) return value

  const [, index, label] = match
  return label?.trim() || tx("GPU {index}", { index })
}

/** Human-readable byte size using decimal (GB/TB) units, matching disk specs. */
export function formatBytes(bytes: number): string {
  const locale = localeToLanguageTag(getRuntimeLocale())
  const format = (value: number, digits: number) =>
    value.toLocaleString(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    })
  if (bytes >= 1e12) return `${format(bytes / 1e12, 2)} TB`
  if (bytes >= 1e9) return `${format(bytes / 1e9, 1)} GB`
  if (bytes >= 1e6) return `${format(bytes / 1e6, 0)} MB`
  if (bytes >= 1e3) return `${format(bytes / 1e3, 0)} KB`
  return `${bytes} B`
}

/** Rough target Mbps per resolution at 60 FPS, used when bitrate is "Auto". */
const AUTO_MBPS_BY_RESOLUTION: Record<RecordingResolution, number> = {
  source: 24,
  "720p": 8,
  "1080p": 16,
  "1440p": 32,
  "2160p": 64,
}

/** Approximate bytes written per hour for the given quality. */
export function estimateHourlyBytes(
  resolution: RecordingResolution,
  fps: RecordingFrameRate,
  bitrate: RecordingBitrate,
): number {
  const mbps =
    bitrate === "auto"
      ? AUTO_MBPS_BY_RESOLUTION[resolution] * (fps / 60)
      : Number(bitrate)
  // Mbps -> bytes/hour: * 1e6 bits / 8 * 3600s.
  return Math.round(mbps * 450_000_000)
}

export interface QualityPresetOption {
  id: Exclude<RecordingQualityProfile, "custom">
  label: string
  resolution: RecordingResolution
  fps: RecordingFrameRate
  bitrate: RecordingBitrate
}

const QUALITY_PROFILE_LABELS: Record<
  Exclude<RecordingQualityProfile, "custom">,
  string
> = {
  low: tx("Low"),
  standard: tx("Standard"),
  high: tx("High"),
}

/**
 * One-click quality presets. Each applies resolution, frame rate, and bitrate;
 * encoder, GPU, and codec are left untouched.
 */
export const RECORDING_QUALITY_PRESETS: QualityPresetOption[] =
  CONTRACT_RECORDING_QUALITY_PRESETS.map((preset) => ({
    ...preset,
    label: QUALITY_PROFILE_LABELS[preset.id],
  }))

export const CUSTOM_QUALITY_LABEL = tx("Custom")

/** The preset selected in settings, or null when Custom is selected. */
export function selectedQualityPreset(
  settings: RecordingSettings,
): QualityPresetOption | null {
  return (
    RECORDING_QUALITY_PRESETS.find(
      (preset) => preset.id === settings.qualityProfile,
    ) ?? null
  )
}

export function applyQualitySettings(
  settings: RecordingSettings,
  quality: RecordingQualitySettings,
): RecordingSettings {
  return {
    ...settings,
    resolution: quality.resolution,
    fps: quality.fps,
    bitrate: quality.bitrate,
  }
}

export function asLiteral<const T extends readonly string[]>(
  value: string | null,
  allowed: T,
): T[number] | null {
  return value !== null && allowed.includes(value) ? (value as T[number]) : null
}

export function asNumberLiteral<const T extends readonly number[]>(
  value: string | null,
  allowed: T,
): T[number] | null {
  if (value === null) return null
  const numberValue = Number(value)
  return allowed.includes(numberValue) ? (numberValue as T[number]) : null
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining === 0 ? `${minutes}m` : `${minutes}m ${remaining}s`
}
