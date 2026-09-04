import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  type OAuthProviderConfig,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { isLoopbackHostname } from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"

import { OAuthProvidersSchema } from "./config/oauth-schema"
import { parseServerEnvRaw, storageConfigFromRaw } from "./env-runtime-schema"
import {
  resolveFfmpegPath,
  resolveFfprobePath,
} from "./media/transcode-settings"
import { lazy } from "./runtime/lazy"

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

const ScopeSchema = t.array(t.string().trim().min(1)).optional()
const AuthParamsSchema = t
  .record(t.string(), t.union([t.string(), t.number(), t.boolean()]))
  .optional()

const AllauthOidcAppSettingsSchema = t.object({
  server_url: t.string().trim().url().optional(),
  discovery_url: t.string().trim().url().optional(),
  authorization_url: t.string().trim().url().optional(),
  token_url: t.string().trim().url().optional(),
  userinfo_url: t.string().trim().url().optional(),
  scope: ScopeSchema,
  oauth_pkce_enabled: t.boolean().optional(),
  token_auth_method: t.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uid_field: t.string().trim().min(1).optional(),
  fetch_userinfo: t.boolean().optional(),
  auth_params: AuthParamsSchema,
  enabled: t.boolean().optional(),
  icon_url: t.string().trim().url().optional(),
  button_color: t.string().trim().optional(),
  button_text_color: t.string().trim().optional(),
  username_claim: t.string().trim().min(1).optional(),
  avatar_claim: t.string().trim().min(1).optional(),
  quota_claim: t.string().trim().min(1).optional(),
  role_claim: t.string().trim().min(1).optional(),
})

const AllauthOidcAppSchema = t.object({
  provider_id: t.string().trim().min(1),
  name: t.string().trim().min(1),
  client_id: t.string().trim().min(1),
  secret: t.string().trim().min(1),
  settings: AllauthOidcAppSettingsSchema.$default({}),
})

const AllauthProvidersSchema = t
  .object({
    openid_connect: t
      .object({
        SCOPE: ScopeSchema,
        OAUTH_PKCE_ENABLED: t.boolean().optional(),
        APPS: t.array(AllauthOidcAppSchema).$default([]),
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
        JSON.stringify(t.flattenError(parsed.error).fieldErrors, null, 2),
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
  value: Record<string, string | number | boolean> | undefined,
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

  const raw = parseServerEnvRaw(source, defaultPublicServerUrl)
  const publicServerUrl = new URL(raw.PUBLIC_SERVER_URL)

  if (raw.NODE_ENV === "production" && publicServerUrl.protocol !== "https:") {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must use HTTPS in production.",
    )
  }

  if (
    raw.NODE_ENV === "production" &&
    isLoopbackHostname(publicServerUrl.hostname)
  ) {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production.",
    )
  }

  const storage = storageConfigFromRaw(raw)

  const viewerCookieSecret = requiredSecret(
    source,
    "ALLOY_VIEWER_COOKIE_SECRET",
  )
  const uploadHmacSecret = requiredSecret(source, "ALLOY_UPLOAD_HMAC_SECRET")
  const steamgriddbApiKey = envText(source, "ALLOY_STEAMGRIDDB_API_KEY") ?? ""
  const socialProviders = envText(source, "ALLOY_SOCIALACCOUNT_PROVIDERS")
  const envSocialProviders =
    socialProviders === undefined ? null : parseSocialProviders(socialProviders)
  const ffmpegPath = resolveFfmpegPath(raw.ALLOY_FFMPEG_PATH)

  return {
    NODE_ENV: raw.NODE_ENV,
    DATABASE_URL: raw.DATABASE_URL,
    PUBLIC_SERVER_URL: raw.PUBLIC_SERVER_URL,
    PORT: raw.PORT,
    WEB_DIST_DIR: raw.WEB_DIST_DIR,
    TRUSTED_ORIGINS: raw.TRUSTED_ORIGINS,
    // null = env var unset → the setting is DB-owned (admin UI editable).
    authEnv: {
      openRegistrations: raw.ALLOY_OPEN_REGISTRATIONS,
      passkeyEnabled: raw.ALLOY_PASSKEY_ENABLED,
      requireAuthToBrowse: raw.ALLOY_REQUIRE_AUTH_TO_BROWSE,
      oauthProviders: envSocialProviders?.oauthProviders ?? null,
      oauthClientSecrets: envSocialProviders?.oauthClientSecrets ?? null,
    },
    oauthAvatarAllowPrivateUrls: raw.ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS,
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
  } as const
}

export type ServerEnv = ReturnType<typeof parseServerEnv>

/**
 * Parsed on first property read, not at import, so importing a module never
 * validates env as a side effect. `src/index.ts` reads env immediately, so a
 * misconfigured deploy still fails at boot.
 */
export const env = lazy(parseServerEnv)
