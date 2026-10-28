import {
  AppearanceConfigSchema,
  isObjectRecord,
  LimitsConfigSchema,
  TranscodingConfigSchema,
  UploadLimitsSchema,
  type AppearanceConfig,
  type ContractJsonValue,
  type LimitsConfig,
  type OidcConfig,
  type TranscodingConfig,
  type UploadLimits,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { SafeParseResult } from "@alloy/contracts/schema-validation"

import { OidcSettingsSchema } from "./oidc-schema"
import type { ConfigOverrides } from "./overrides"

export const AuthSettingsSchema = t.object({
  openRegistrations: t.boolean().$default(false),
  passkeyEnabled: t.boolean().$default(true),
  requireAuthToBrowse: t.boolean().$default(true),
})

export type AuthSettings = t.infer<typeof AuthSettingsSchema>

export interface ConfigSectionValues {
  auth: AuthSettings
  oidc: OidcConfig
  appearance: AppearanceConfig
  transcoding: TranscodingConfig
  uploadLimits: UploadLimits
  limits: LimitsConfig
}

export type ConfigSectionName = keyof ConfigSectionValues

/** One ALLOY_* variable and the section field it sets. */
export interface ConfigEnvSetting {
  name: string
  path: readonly string[]
  parse: (raw: string) => ContractJsonValue
}

interface ConfigSection<Value> {
  /** The instance_setting row holding the values saved in the admin UI. */
  key: string
  schema: { safeParse(input: ContractJsonValue): SafeParseResult<Value> }
  /** Built-in values the schema has no default for. */
  builtin: ConfigOverrides
  env: readonly ConfigEnvSetting[]
}

const BOOLEAN_VALUES = new Map<string, boolean>([
  ["1", true],
  ["true", true],
  ["yes", true],
  ["on", true],
  ["0", false],
  ["false", false],
  ["no", false],
  ["off", false],
])

function boolean(raw: string): boolean {
  const value = BOOLEAN_VALUES.get(raw.toLowerCase())
  if (value === undefined) throw new Error("Expected true or false")
  return value
}

function integer(raw: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error("Expected a whole number")
  return Number(raw)
}

function decimal(raw: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error("Expected a number")
  return value
}

function text(raw: string): string {
  return raw
}

function list(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean)
}

function hexColor(raw: string): string {
  const value = raw.toLowerCase()
  return value.startsWith("#") ? value : `#${value}`
}

function json(raw: string): ContractJsonValue {
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `Expected JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

function stringRecord(raw: string): Record<string, string> {
  const value = json(raw)
  if (!isObjectRecord(value)) throw new Error("Expected a JSON object")
  return Object.fromEntries(
    Object.entries(value).map(([key, param]) => {
      if (param === null || Array.isArray(param) || isObjectRecord(param)) {
        throw new Error(`Expected a string, number, or boolean for ${key}`)
      }
      return [key, String(param)]
    }),
  )
}

function setting(
  name: string,
  path: string,
  parse: (raw: string) => ContractJsonValue,
): ConfigEnvSetting {
  return { name, path: path.split("."), parse }
}

/**
 * The admin-editable config. Each section resolves built-in defaults, then
 * its ALLOY_* variables, then the values saved in the admin UI.
 */
type ConfigSections = {
  [Name in ConfigSectionName]: ConfigSection<ConfigSectionValues[Name]>
}

const SECTIONS: ConfigSections = {
  auth: {
    key: "auth",
    schema: AuthSettingsSchema,
    builtin: {},
    env: [
      setting("ALLOY_OPEN_REGISTRATIONS", "openRegistrations", boolean),
      setting("ALLOY_PASSKEY_ENABLED", "passkeyEnabled", boolean),
      setting("ALLOY_REQUIRE_AUTH_TO_BROWSE", "requireAuthToBrowse", boolean),
    ],
  },
  oidc: {
    key: "oidc",
    schema: OidcSettingsSchema,
    builtin: {},
    env: [
      setting("ALLOY_OIDC_ENABLED", "enabled", boolean),
      setting("ALLOY_OIDC_DISPLAY_NAME", "displayName", text),
      setting("ALLOY_OIDC_CLIENT_ID", "clientId", text),
      setting("ALLOY_OIDC_ISSUER_URL", "issuerUrl", text),
      setting("ALLOY_OIDC_AUTHORIZATION_URL", "authorizationUrl", text),
      setting("ALLOY_OIDC_TOKEN_URL", "tokenUrl", text),
      setting("ALLOY_OIDC_USERINFO_URL", "userInfoUrl", text),
      setting("ALLOY_OIDC_SCOPES", "scopes", list),
      setting("ALLOY_OIDC_ALLOW_SIGN_UP", "allowSignUp", boolean),
      setting("ALLOY_OIDC_PKCE", "pkce", boolean),
      setting("ALLOY_OIDC_TOKEN_AUTH_METHOD", "tokenAuthMethod", text),
      setting("ALLOY_OIDC_FETCH_USERINFO", "fetchUserInfo", boolean),
      setting("ALLOY_OIDC_AUTH_PARAMS", "authParams", stringRecord),
      setting("ALLOY_OIDC_UID_CLAIM", "uidClaim", text),
      setting("ALLOY_OIDC_USERNAME_CLAIM", "usernameClaim", text),
      setting("ALLOY_OIDC_AVATAR_CLAIM", "avatarClaim", text),
      setting("ALLOY_OIDC_QUOTA_CLAIM", "quotaClaim", text),
      setting("ALLOY_OIDC_ROLE_CLAIM", "roleClaim", text),
    ],
  },
  appearance: {
    key: "appearance",
    schema: AppearanceConfigSchema,
    builtin: {
      loginSplash: { enabled: false, blurPx: 24, darkenOpacity: 0.8 },
      accentColors: { light: null, dark: null },
    },
    env: [
      setting("ALLOY_ACCENT_COLOR_LIGHT", "accentColors.light", hexColor),
      setting("ALLOY_ACCENT_COLOR_DARK", "accentColors.dark", hexColor),
      setting("ALLOY_LOGIN_SPLASH_ENABLED", "loginSplash.enabled", boolean),
      setting("ALLOY_LOGIN_SPLASH_BLUR_PX", "loginSplash.blurPx", decimal),
      setting(
        "ALLOY_LOGIN_SPLASH_DARKEN_OPACITY",
        "loginSplash.darkenOpacity",
        decimal,
      ),
    ],
  },
  transcoding: {
    key: "transcoding",
    schema: TranscodingConfigSchema,
    builtin: {},
    env: [
      setting("ALLOY_TRANSCODE_VIDEO_CODEC", "videoCodec", text),
      setting(
        "ALLOY_TRANSCODE_HARDWARE_ACCELERATION",
        "hardwareAcceleration",
        text,
      ),
      setting("ALLOY_TRANSCODE_VAAPI_DEVICE", "vaapiDevice", text),
      setting("ALLOY_TRANSCODE_QUALITY", "quality", integer),
      setting(
        "ALLOY_TRANSCODE_AUDIO_BITRATE_KBPS",
        "audioBitrateKbps",
        integer,
      ),
      setting("ALLOY_TRANSCODE_TIERS", "tiers", json),
    ],
  },
  uploadLimits: {
    key: "uploadLimits",
    schema: UploadLimitsSchema,
    builtin: {},
    env: [
      setting(
        "ALLOY_UPLOAD_SCREENSHOT_MAX_BYTES",
        "screenshotMaxBytes",
        integer,
      ),
      setting(
        "ALLOY_UPLOAD_SCREENSHOT_MAX_PIXELS",
        "screenshotMaxPixels",
        integer,
      ),
      setting("ALLOY_UPLOAD_AVATAR_MAX_BYTES", "avatarMaxBytes", integer),
      setting("ALLOY_UPLOAD_BANNER_MAX_BYTES", "bannerMaxBytes", integer),
      setting(
        "ALLOY_UPLOAD_GAME_ASSET_MAX_BYTES",
        "gameAssetMaxBytes",
        integer,
      ),
    ],
  },
  limits: {
    key: "limits",
    schema: LimitsConfigSchema,
    builtin: {},
    env: [
      setting(
        "ALLOY_DEFAULT_STORAGE_QUOTA_BYTES",
        "defaultStorageQuotaBytes",
        integer,
      ),
      setting("ALLOY_UPLOAD_TTL_SEC", "uploadTtlSec", integer),
    ],
  },
}

export const CONFIG_SECTION_NAMES = [
  "auth",
  "oidc",
  "appearance",
  "transcoding",
  "uploadLimits",
  "limits",
] as const satisfies readonly ConfigSectionName[]

export function configSection<Name extends ConfigSectionName>(
  name: Name,
): ConfigSection<ConfigSectionValues[Name]> {
  return SECTIONS[name]
}
