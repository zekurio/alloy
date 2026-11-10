import { isLoopbackHostname } from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"

import { parseConfigEnv } from "./config/env-config"
import { parseServerEnvRaw, storageConfigFromRaw } from "./env-runtime-schema"
import {
  resolveFfmpegPath,
  resolveFfprobePath,
} from "./media/transcode-settings"

// Deploy-time env is the only source for storage, integrations, and secret
// material. Admin-editable settings take their defaults from env (see
// config/sections.ts) and their saved overrides from Postgres.

// Fill in unset variables from the workspace `.env` (local dev outside Nix);
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

function requiredText(source: EnvSource, name: string): string {
  const value = envText(source, name)
  if (!value) {
    throw new Error(`[server/env] ${name} is required.`)
  }
  return value
}

function parseServerEnv(source: EnvSource = process.env) {
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

  // Game search, artwork, and canonical game names all come from SteamGridDB,
  // so a server without a key would be missing core features.
  const steamgriddbApiKey = requiredText(source, "ALLOY_STEAMGRIDDB_API_KEY")
  const ffmpegPath = resolveFfmpegPath(raw.ALLOY_FFMPEG_PATH)
  const setupToken = envText(source, "ALLOY_SETUP_TOKEN") ?? null
  if (setupToken !== null && setupToken.length < 32) {
    throw new Error(
      "[server/env] ALLOY_SETUP_TOKEN must be at least 32 characters.",
    )
  }

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
    steamgriddbApiKey,
    setupToken,
  } as const
}

/** Parsed once at startup, so a misconfigured deploy fails at boot. */
export const env = parseServerEnv()
