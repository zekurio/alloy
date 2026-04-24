import type {
  AdminOAuthProvider,
  EncoderCodec,
  EncoderHwaccel,
} from "@workspace/api"

export function emptyProvider(): AdminOAuthProvider {
  return {
    providerId: "",
    displayName: "Custom OIDC",
    clientId: "",
    clientSecret: "",
    scopes: ["openid", "profile", "email"],
    enabled: true,
    discoveryUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    pkce: true,
    usernameClaim: "preferred_username",
  }
}

function normalizeAuthBaseURL(authBaseURL: string): string {
  return authBaseURL.endsWith("/") ? authBaseURL.slice(0, -1) : authBaseURL
}

export function callbackURLForProvider(
  authBaseURL: string,
  providerId: string
): string {
  return `${normalizeAuthBaseURL(authBaseURL)}/api/auth/oauth2/callback/${
    providerId || "{providerId}"
  }`
}

export function toSubmissionProvider(
  provider: AdminOAuthProvider
): AdminOAuthProvider {
  return {
    ...provider,
    providerId: provider.providerId.trim(),
    displayName: provider.displayName.trim(),
    clientId: provider.clientId.trim(),
    clientSecret: provider.clientSecret.trim(),
    scopes: provider.scopes?.map((scope) => scope.trim()).filter(Boolean),
    discoveryUrl: emptyToUndefined(provider.discoveryUrl),
    authorizationUrl: emptyToUndefined(provider.authorizationUrl),
    tokenUrl: emptyToUndefined(provider.tokenUrl),
    userInfoUrl: emptyToUndefined(provider.userInfoUrl),
    usernameClaim: emptyToUndefined(provider.usernameClaim),
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

export function defaultPresetFor(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec
): string {
  const suggestions = presetSuggestionsFor(hwaccel, codec)
  if (suggestions.includes("medium")) return "medium"
  if (suggestions.includes("balanced")) return "balanced"
  if (suggestions.includes("p4")) return "p4"
  if (suggestions.includes("6")) return "6"
  return suggestions[0] ?? "medium"
}

export function ffmpegEncoderName(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec
): string {
  if (hwaccel === "software") {
    switch (codec) {
      case "h264":
        return "libx264"
      case "hevc":
        return "libx265"
      case "av1":
        return "libsvtav1"
    }
  }
  return `${codec}_${hwaccel}`
}

export function normalizeGlobalPreset(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec,
  preset: string
): string {
  return presetSuggestionsFor(hwaccel, codec).includes(preset)
    ? preset
    : defaultPresetFor(hwaccel, codec)
}

export function normalizeVariantPreset(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec,
  preset: string | undefined
): string | undefined {
  if (preset === undefined) return undefined
  return presetSuggestionsFor(hwaccel, codec).includes(preset)
    ? preset
    : undefined
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
