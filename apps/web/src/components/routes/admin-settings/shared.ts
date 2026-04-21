import type {
  AdminOAuthProvider,
  EncoderCodec,
  EncoderHwaccel,
} from "../../../lib/admin-api"

export function emptyProvider(): AdminOAuthProvider {
  return {
    providerId: "",
    displayName: "",
    clientId: "",
    clientSecret: "",
    scopes: [],
    discoveryUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    pkce: true,
    usernameClaim: "preferred_username",
  }
}

export function emptyToUndefined(
  value: string | undefined
): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export const HWACCEL_LABEL: Record<EncoderHwaccel, string> = {
  software: "Software (libx264 / libx265)",
  nvenc: "NVIDIA NVENC",
  qsv: "Intel Quick Sync (QSV)",
  amf: "AMD AMF",
  vaapi: "VA-API (Linux)",
}

export const PRESET_SUGGESTIONS: Record<
  EncoderHwaccel,
  ReadonlyArray<string>
> = {
  software: [
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
  ],
  nvenc: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  qsv: ["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
  amf: ["speed", "balanced", "quality"],
  vaapi: [],
}

const SVT_AV1_PRESETS: ReadonlyArray<string> = [
  "0",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
]

export function presetSuggestionsFor(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec
): ReadonlyArray<string> {
  if (hwaccel === "software" && codec === "av1") return SVT_AV1_PRESETS
  return PRESET_SUGGESTIONS[hwaccel]
}

export const QUALITY_LABEL: Record<EncoderHwaccel, string> = {
  software: "CRF",
  nvenc: "CQ",
  qsv: "global_quality (ICQ)",
  amf: "QP",
  vaapi: "QP",
}

export function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
