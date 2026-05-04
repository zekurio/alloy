export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

export interface ClipVariantSettings {
  hwaccel: string
  codec: string
  audioCodec: "aac" | "none"
  quality: number
  preset?: string
  audioBitrateKbps: number
  extraInputArgs: string
  extraOutputArgs: string
  height: number
  trimStartMs: number | null
  trimEndMs: number | null
}

export interface ClipEncodedVariant {
  id: string
  label: string
  role?: "source" | "variant" | "openGraph"
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
  /**
   * Optional because rows written before this field existed don't have
   * it. Missing settings are treated as "unknown -> re-encode".
   */
  settings?: ClipVariantSettings
  remuxSettings?: {
    trimStartMs: number | null
    trimEndMs: number | null
  }
}
