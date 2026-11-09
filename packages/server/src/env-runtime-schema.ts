import { isIP } from "node:net"

import type { StorageConfig } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import {
  createEnv,
  normalizeOrigin,
  normalizePublicServerUrl,
  postgresUrl,
} from "@alloy/env"

import { TRANSCODE_DEFAULTS } from "./media/transcode-settings"

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
  return t.object({
    NODE_ENV: t
      .enum(["development", "production", "test"])
      .$default("development"),
    DATABASE_URL: postgresUrl(),
    PUBLIC_SERVER_URL: t
      .url()
      .$default(defaultPublicServerUrl)
      .transform(normalizePublicServerUrl),
    PORT: t.coerce.number().int().positive().$default(2552),
    WEB_DIST_DIR: t.string().optional(),
    TRUSTED_ORIGINS: t
      .string()
      .$default(defaultPublicServerUrl)
      .transform((value) =>
        normalizeTrustedOrigins(value, defaultPublicServerUrl),
      ),
    // Peers allowed to report the client address through X-Forwarded-For.
    // Unset trusts nobody: every request is keyed on its socket address.
    ALLOY_TRUSTED_PROXIES: t
      .string()
      .refine(
        (value) => splitList(value).every(isIpOrCidr),
        "Expected comma-separated IP addresses or CIDR ranges",
      )
      .$default("")
      .transform(splitList),
    ALLOY_STORAGE_FS_CLIPS_PATH: t
      .string()
      .trim()
      .min(1)
      .$default("storage/clips"),
    ALLOY_STORAGE_FS_THUMBNAILS_PATH: t
      .string()
      .trim()
      .min(1)
      .$default("storage/thumbnails"),
    ALLOY_STORAGE_FS_ASSETS_PATH: t
      .string()
      .trim()
      .min(1)
      .$default("storage/assets"),
    ALLOY_FFMPEG_PATH: t.string().trim().min(1).optional(),
    ALLOY_FFPROBE_PATH: t.string().trim().min(1).optional(),
    ALLOY_TRANSCODE_CONCURRENCY: t.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .$default(1),
    // 0 lets ffmpeg pick (all cores). Lower it to keep encodes from
    // starving the API on small hosts.
    ALLOY_TRANSCODE_THREADS: t.coerce
      .number()
      .int()
      .min(0)
      .max(64)
      .$default(TRANSCODE_DEFAULTS.threads),
  })
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isIpOrCidr(value: string): boolean {
  const [address = "", prefix, ...rest] = value.split("/")
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  if (prefix === undefined) return true
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= (family === 4 ? 32 : 128)
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
