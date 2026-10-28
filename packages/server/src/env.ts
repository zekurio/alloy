import { isLoopbackHostname } from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"

import { parseConfigEnv } from "./config/env-config"
import { parseServerEnvRaw, storageConfigFromRaw } from "./env-runtime-schema"
import {
  resolveFfmpegPath,
  resolveFfprobePath,
} from "./media/transcode-settings"
import { lazy } from "./runtime/lazy"

// Deploy-time env is the only source for storage, integrations, and secret
// material. Admin-editable settings take their defaults from env (see
// config/sections.ts) and their saved overrides from Postgres.

// Fill in unset variables from the workspace `.env` (non-devenv local dev);
// real shell environment always wins. Production deployments set NODE_ENV in
// the wrapper and never probe the filesystem.
if (process.env.NODE_ENV !== "production") {
  loadDotenv()
}

type EnvSource = Record<string, string | undefined>

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

function requiredText(source: EnvSource, name: string): string {
  const value = envText(source, name)
  if (!value) {
    throw new Error(`[server/env] ${name} is required.`)
  }
  return value
}

// Variables that configured removed features. Failing beats silently running
// without the sign-in they used to set up.
const REMOVED_ENV = {
  ALLOY_SOCIALACCOUNT_PROVIDERS:
    "Alloy now has one OpenID Connect provider. Configure it with the ALLOY_OIDC_* variables (see .env.example) or in the admin settings.",
} as const

export function parseServerEnv(source: EnvSource = process.env) {
  for (const [name, hint] of Object.entries(REMOVED_ENV)) {
    if (envText(source, name)) {
      throw new Error(`[server/env] ${name} is no longer supported. ${hint}`)
    }
  }

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
  // Game search, artwork, and canonical game names all come from SteamGridDB,
  // so a server without a key would be missing core features.
  const steamgriddbApiKey = requiredText(source, "ALLOY_STEAMGRIDDB_API_KEY")
  const ffmpegPath = resolveFfmpegPath(raw.ALLOY_FFMPEG_PATH)

  return {
    NODE_ENV: raw.NODE_ENV,
    DATABASE_URL: raw.DATABASE_URL,
    PUBLIC_SERVER_URL: raw.PUBLIC_SERVER_URL,
    PORT: raw.PORT,
    WEB_DIST_DIR: raw.WEB_DIST_DIR,
    TRUSTED_ORIGINS: raw.TRUSTED_ORIGINS,
    trustedProxies: raw.ALLOY_TRUSTED_PROXIES,
    config: parseConfigEnv(source),
    oauthAvatarAllowPrivateUrls: raw.ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS,
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

/**
 * Parsed on first property read, not at import, so importing a module never
 * validates env as a side effect. `src/index.ts` reads env immediately, so a
 * misconfigured deploy still fails at boot.
 */
export const env = lazy(parseServerEnv)
