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
const EnvBooleanSchema = t.boolean()
const EnvStringSchema = t.string()

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
    // OAuth avatar sync refuses provider avatar URLs that resolve to
    // private/loopback addresses (SSRF guard). Self-hosted LAN IdPs whose
    // avatar URLs live on the private network can opt back in here.
    ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS: envBool(false),
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

function envBool(defaultValue: boolean) {
  return t
    .preprocess((value) => {
      if (value === undefined || value === "") return defaultValue
      const booleanValue = EnvBooleanSchema.safeParse(value)
      if (booleanValue.success) return booleanValue.data
      const stringValue = EnvStringSchema.safeParse(value)
      if (!stringValue.success) return value
      return boolValues.get(stringValue.data.trim().toLowerCase()) ?? value
    }, t.boolean())
    .$default(defaultValue)
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
