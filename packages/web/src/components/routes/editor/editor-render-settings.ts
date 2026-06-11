import {
  getFirstEncodableVideoCodec,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
} from "mediabunny"

/**
 * Render settings model: the option spaces the render dialog offers, their
 * defaults, and the mediabunny mappings the offline renderer consumes.
 */

export const RENDER_CODECS = ["avc", "hevc", "vp9", "av1"] as const
export type RenderCodec = (typeof RENDER_CODECS)[number]
/** Output height caps; "source" renders at the largest source's size. */
export const RENDER_RESOLUTIONS = ["source", "1440", "1080", "720"] as const
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number]
export const RENDER_FPS_OPTIONS = [30, 60] as const
export type RenderFps = (typeof RENDER_FPS_OPTIONS)[number]
export const RENDER_QUALITIES = ["medium", "high", "very-high"] as const
export type RenderQuality = (typeof RENDER_QUALITIES)[number]
/**
 * Encoder backend hint. WebCodecs can't target a specific GPU, only express
 * a preference: "gpu" leans on hardware encoders, "cpu" forces software.
 */
export const RENDER_ACCELERATIONS = ["auto", "gpu", "cpu"] as const
export type RenderAcceleration = (typeof RENDER_ACCELERATIONS)[number]

export interface RenderSettings {
  codec: RenderCodec
  resolution: RenderResolution
  fps: RenderFps
  quality: RenderQuality
  acceleration: RenderAcceleration
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  codec: "avc",
  resolution: "1080",
  fps: 60,
  quality: "high",
  acceleration: "auto",
}

export const QUALITY_BY_SETTING = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  "very-high": QUALITY_VERY_HIGH,
} as const

export const HARDWARE_BY_ACCELERATION = {
  auto: "no-preference",
  gpu: "prefer-hardware",
  cpu: "prefer-software",
} as const satisfies Record<
  RenderAcceleration,
  "no-preference" | "prefer-hardware" | "prefer-software"
>

/** The finished render: encoded MP4 bytes plus its display metadata. */
export interface RenderedProject {
  data: Uint8Array
  durationMs: number
  width: number
  height: number
}

/** Codecs this machine can actually encode (for the settings form). */
export async function encodableRenderCodecs(): Promise<RenderCodec[]> {
  const checks = await Promise.all(
    RENDER_CODECS.map(async (codec) =>
      (await getFirstEncodableVideoCodec([codec], {
        width: 1920,
        height: 1080,
      }))
        ? codec
        : null,
    ),
  )
  return checks.filter((codec): codec is RenderCodec => codec !== null)
}
