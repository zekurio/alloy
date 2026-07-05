import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  type OAuthProviderConfig,
  type StorageConfig,
} from "@alloy/contracts"
import {
  createEnv,
  isLoopbackHostname,
  normalizeOrigin,
  normalizePublicServerUrl,
  postgresUrl,
} from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"
import { z } from "zod"

import { OAuthProvidersSchema } from "./config/oauth-schema"
import {
  resolveFfmpegPath,
  resolveFfprobePath,
  TRANSCODE_DEFAULTS,
} from "./media/transcode-settings"

// Deploy-time env is the only source for server policy, storage, integrations,
// OAuth, and secret material. Instance UI/state settings live in Postgres.

// Fill in unset variables from the workspace `.env` (non-devenv local dev);
// real shell environment always wins. Production deployments set NODE_ENV in
// the wrapper and never probe the filesystem.
if (process.env.NODE_ENV !== "production") {
  loadDotenv()
}

type EnvSource = Record<string, string | undefined>

type ParsedSocialProviders = {
  oauthProviders: OAuthProviderConfig[]
  oauthClientSecrets: Record<string, string>
}

const boolValues = new Map<string, boolean>([
  ["1", true],
  ["true", true],
  ["yes", true],
  ["on", true],
  ["0", false],
  ["false", false],
  ["no", false],
  ["off", false],
])

function envBool(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue
    if (typeof value === "boolean") return value
    if (typeof value !== "string") return value
    return boolValues.get(value.trim().toLowerCase()) ?? value
  }, z.boolean())
}

function optionalPositiveIntegerOrNull() {
  return z
    .preprocess((value) => {
      if (value === undefined || value === "") return null
      return value
    }, z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable())
    .default(null)
}

function normalizeTrustedOrigins(
  value: string,
  defaultPublicServerUrl: string,
): string[] {
  const origins = new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin),
  )
  origins.add(normalizeOrigin(defaultPublicServerUrl))
  return [...origins]
}

function envText(source: EnvSource, name: string): string | undefined {
  const value = source[name]?.trim()
  return value ? value : undefined
}

function requiredSecret(source: EnvSource, name: string): string {
  const value = envText(source, name)
  if (!value) {
    throw new Error(`[server/env] ${name} is required.`)
  }
  if (value.length < 32) {
    throw new Error(`[server/env] ${name} must be at least 32 characters.`)
  }
  return value
}

const ScopeSchema = z.array(z.string().trim().min(1)).optional()
const AuthParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()

const AllauthOidcAppSettingsSchema = z.object({
  server_url: z.string().trim().url().optional(),
  discovery_url: z.string().trim().url().optional(),
  authorization_url: z.string().trim().url().optional(),
  token_url: z.string().trim().url().optional(),
  userinfo_url: z.string().trim().url().optional(),
  scope: ScopeSchema,
  oauth_pkce_enabled: z.boolean().optional(),
  token_auth_method: z.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uid_field: z.string().trim().min(1).optional(),
  fetch_userinfo: z.boolean().optional(),
  auth_params: AuthParamsSchema,
  enabled: z.boolean().optional(),
  icon_url: z.string().trim().url().optional(),
  button_color: z.string().trim().optional(),
  button_text_color: z.string().trim().optional(),
  username_claim: z.string().trim().min(1).optional(),
  avatar_claim: z.string().trim().min(1).optional(),
  quota_claim: z.string().trim().min(1).optional(),
  role_claim: z.string().trim().min(1).optional(),
})

const AllauthOidcAppSchema = z.object({
  provider_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  client_id: z.string().trim().min(1),
  secret: z.string().trim().min(1),
  settings: AllauthOidcAppSettingsSchema.default({}),
})

const AllauthProvidersSchema = z
  .object({
    openid_connect: z
      .object({
        SCOPE: ScopeSchema,
        OAUTH_PKCE_ENABLED: z.boolean().optional(),
        APPS: z.array(AllauthOidcAppSchema).default([]),
      })
      .optional(),
  })
  .strict()

function parseSocialProviders(raw: string | undefined): ParsedSocialProviders {
  if (!raw) return { oauthProviders: [], oauthClientSecrets: {} }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `[server/env] ALLOY_SOCIALACCOUNT_PROVIDERS is not valid JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
  }

  const parsed = AllauthProvidersSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new Error(
      "[server/env] Invalid ALLOY_SOCIALACCOUNT_PROVIDERS:\n" +
        JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
    )
  }

  const oauthClientSecrets: Record<string, string> = {}
  const providers = (parsed.data.openid_connect?.APPS ?? []).map((app) => {
    const settings = app.settings
    oauthClientSecrets[app.provider_id] = app.secret
    return {
      providerId: app.provider_id,
      displayName: app.name,
      clientId: app.client_id,
      scopes: settings.scope ?? parsed.data.openid_connect?.SCOPE,
      enabled: settings.enabled ?? true,
      buttonColor: settings.button_color,
      buttonTextColor: settings.button_text_color,
      iconUrl: settings.icon_url,
      discoveryUrl: settings.discovery_url ?? settings.server_url,
      authorizationUrl: settings.authorization_url,
      tokenUrl: settings.token_url,
      userInfoUrl: settings.userinfo_url,
      pkce:
        settings.oauth_pkce_enabled ??
        parsed.data.openid_connect?.OAUTH_PKCE_ENABLED ??
        true,
      tokenAuthMethod: settings.token_auth_method,
      uidClaim: settings.uid_field ?? "sub",
      fetchUserInfo: settings.fetch_userinfo ?? true,
      authParams: authParams(settings.auth_params),
      usernameClaim: settings.username_claim ?? OAUTH_USERNAME_CLAIM_DEFAULT,
      avatarClaim: settings.avatar_claim ?? OAUTH_AVATAR_CLAIM_DEFAULT,
      quotaClaim: settings.quota_claim ?? OAUTH_QUOTA_CLAIM_DEFAULT,
      roleClaim: settings.role_claim ?? OAUTH_ROLE_CLAIM_DEFAULT,
    }
  })

  return {
    oauthProviders: OAuthProvidersSchema.parse(providers),
    oauthClientSecrets,
  }
}

function authParams(
  value: z.infer<typeof AuthParamsSchema>,
): Record<string, string> | undefined {
  if (!value) return undefined
  const params = Object.fromEntries(
    Object.entries(value).map(([key, param]) => [key, String(param)]),
  )
  return Object.keys(params).length > 0 ? params : undefined
}

export function parseServerEnv(source: EnvSource = process.env) {
  const defaultPublicServerUrl =
    source.PUBLIC_SERVER_URL ?? "http://localhost:2552"

  const raw = createEnv(
    z.object({
      NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
      DATABASE_URL: postgresUrl(),
      PUBLIC_SERVER_URL: z
        .url()
        .default(defaultPublicServerUrl)
        .transform(normalizePublicServerUrl),
      PORT: z.coerce.number().int().positive().default(2552),
      WEB_DIST_DIR: z.string().optional(),
      TRUSTED_ORIGINS: z
        .string()
        .default(defaultPublicServerUrl)
        .transform((value) =>
          normalizeTrustedOrigins(value, defaultPublicServerUrl),
        ),
      ALLOY_OPEN_REGISTRATIONS: envBool(false),
      ALLOY_PASSKEY_ENABLED: envBool(true),
      ALLOY_REQUIRE_AUTH_TO_BROWSE: envBool(true),
      ALLOY_DEFAULT_STORAGE_QUOTA_BYTES: optionalPositiveIntegerOrNull(),
      ALLOY_UPLOAD_TTL_SEC: z.coerce
        .number()
        .int()
        .min(60)
        .max(24 * 60 * 60)
        .default(900),
      ALLOY_STORAGE_DRIVER: z.enum(["fs"]).default("fs"),
      ALLOY_STORAGE_FS_CLIPS_PATH: z
        .string()
        .trim()
        .min(1)
        .default("storage/clips"),
      ALLOY_STORAGE_FS_THUMBNAILS_PATH: z
        .string()
        .trim()
        .min(1)
        .default("storage/thumbnails"),
      ALLOY_STORAGE_FS_USERS_PATH: z
        .string()
        .trim()
        .min(1)
        .default("storage/users"),
      ALLOY_STORAGE_FS_GAMES_PATH: z
        .string()
        .trim()
        .min(1)
        .default("storage/games"),
      ALLOY_FFMPEG_PATH: z.string().trim().min(1).optional(),
      ALLOY_FFPROBE_PATH: z.string().trim().min(1).optional(),
      ALLOY_TRANSCODE_CONCURRENCY: z.coerce
        .number()
        .int()
        .min(1)
        .max(16)
        .default(1),
      // 0 lets ffmpeg pick (all cores). Lower it to keep encodes from
      // starving the API on small hosts.
      ALLOY_TRANSCODE_THREADS: z.coerce
        .number()
        .int()
        .min(0)
        .max(64)
        .default(TRANSCODE_DEFAULTS.threads),
    }),
    { label: "server/env", source },
  )

  if (
    raw.NODE_ENV === "production" &&
    isLoopbackHostname(new URL(raw.PUBLIC_SERVER_URL).hostname)
  ) {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production.",
    )
  }

  const storage: StorageConfig = {
    driver: raw.ALLOY_STORAGE_DRIVER,
    fs: {
      clipsPath: raw.ALLOY_STORAGE_FS_CLIPS_PATH,
      thumbnailsPath: raw.ALLOY_STORAGE_FS_THUMBNAILS_PATH,
      usersPath: raw.ALLOY_STORAGE_FS_USERS_PATH,
      gamesPath: raw.ALLOY_STORAGE_FS_GAMES_PATH,
    },
  }

  const viewerCookieSecret = requiredSecret(
    source,
    "ALLOY_VIEWER_COOKIE_SECRET",
  )
  const uploadHmacSecret = requiredSecret(source, "ALLOY_UPLOAD_HMAC_SECRET")
  const steamgriddbApiKey = envText(source, "ALLOY_STEAMGRIDDB_API_KEY") ?? ""
  const socialProviders = envText(source, "ALLOY_SOCIALACCOUNT_PROVIDERS")
  const { oauthProviders, oauthClientSecrets } =
    parseSocialProviders(socialProviders)
  const ffmpegPath = resolveFfmpegPath(raw.ALLOY_FFMPEG_PATH)

  return {
    NODE_ENV: raw.NODE_ENV,
    DATABASE_URL: raw.DATABASE_URL,
    PUBLIC_SERVER_URL: raw.PUBLIC_SERVER_URL,
    PORT: raw.PORT,
    WEB_DIST_DIR: raw.WEB_DIST_DIR,
    TRUSTED_ORIGINS: raw.TRUSTED_ORIGINS,
    openRegistrations: raw.ALLOY_OPEN_REGISTRATIONS,
    passkeyEnabled: raw.ALLOY_PASSKEY_ENABLED,
    requireAuthToBrowse: raw.ALLOY_REQUIRE_AUTH_TO_BROWSE,
    limits: {
      defaultStorageQuotaBytes: raw.ALLOY_DEFAULT_STORAGE_QUOTA_BYTES,
      uploadTtlSec: raw.ALLOY_UPLOAD_TTL_SEC,
    },
    storage,
    transcode: {
      ffmpegPath,
      ffprobePath: resolveFfprobePath(raw.ALLOY_FFPROBE_PATH, ffmpegPath),
      concurrency: raw.ALLOY_TRANSCODE_CONCURRENCY,
      threads: raw.ALLOY_TRANSCODE_THREADS,
    },
    viewerCookieSecret,
    uploadHmacSecret,
    steamgriddbApiKey,
    oauthProviders,
    oauthClientSecrets,
  } as const
}

export type ServerEnv = ReturnType<typeof parseServerEnv>

export const env = parseServerEnv()
