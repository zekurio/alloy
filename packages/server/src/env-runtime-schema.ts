import type { StorageConfig } from "@alloy/contracts"
import {
  createEnv,
  normalizeOrigin,
  normalizePublicServerUrl,
  postgresUrl,
} from "@alloy/env"
import { z } from "zod"

import { TRANSCODE_DEFAULTS } from "./media/transcode-settings"

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

export function parseServerEnvRaw(
  source: Record<string, string | undefined>,
  defaultPublicServerUrl: string,
) {
  return createEnv(serverEnvSchema(defaultPublicServerUrl), {
    label: "server/env",
    source,
  })
}

export function storageConfigFromRaw(raw: {
  ALLOY_STORAGE_FS_CLIPS_PATH: string
  ALLOY_STORAGE_FS_THUMBNAILS_PATH: string
  ALLOY_STORAGE_FS_ASSETS_PATH: string
}): StorageConfig {
  return {
    clipsPath: raw.ALLOY_STORAGE_FS_CLIPS_PATH,
    thumbnailsPath: raw.ALLOY_STORAGE_FS_THUMBNAILS_PATH,
    assetsPath: raw.ALLOY_STORAGE_FS_ASSETS_PATH,
  }
}

function serverEnvSchema(defaultPublicServerUrl: string) {
  return z.object({
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
    ALLOY_OPEN_REGISTRATIONS: envBoolOrNull(),
    ALLOY_PASSKEY_ENABLED: envBoolOrNull(),
    ALLOY_REQUIRE_AUTH_TO_BROWSE: envBoolOrNull(),
    // OAuth avatar sync refuses provider avatar URLs that resolve to
    // private/loopback addresses (SSRF guard). Self-hosted LAN IdPs whose
    // avatar URLs live on the private network can opt back in here.
    ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS: envBool(false),
    ALLOY_DEFAULT_STORAGE_QUOTA_BYTES: optionalPositiveIntegerOrNull(),
    ALLOY_UPLOAD_TTL_SEC: z.coerce
      .number()
      .int()
      .min(60)
      .max(24 * 60 * 60)
      .default(900),
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
    ALLOY_STORAGE_FS_ASSETS_PATH: z
      .string()
      .trim()
      .min(1)
      .default("storage/assets"),
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
  })
}

function envBool(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue
    if (typeof value === "boolean") return value
    if (typeof value !== "string") return value
    return boolValues.get(value.trim().toLowerCase()) ?? value
  }, z.boolean())
}

// An unset (or empty) variable parses to null: the setting is DB-owned and
// editable in the admin UI. An explicit value makes the key env-managed and
// locks the admin UI for it.
function envBoolOrNull() {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return null
    if (typeof value === "boolean" || value === null) return value
    if (typeof value !== "string") return value
    return boolValues.get(value.trim().toLowerCase()) ?? value
  }, z.boolean().nullable())
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
