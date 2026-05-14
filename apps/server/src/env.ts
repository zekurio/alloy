import { isIP } from "node:net"

import { z } from "zod"

// Deploy-time env only. Anything an admin should be able to change at
// runtime (OAuth provider, open-registrations) lives in `config/store.ts`.

function normalizePublicServerUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  url.pathname = ""
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function normalizeTrustedOrigins(value: string): string[] {
  const origins = new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin)
  )
  origins.add(normalizeOrigin(defaultPublicServerUrl))
  return [...origins]
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    (isIP(hostname) === 4 && hostname.startsWith("127.")) ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:3000"

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.url(),
  PUBLIC_SERVER_URL: z
    .url()
    .default(defaultPublicServerUrl)
    .transform(normalizePublicServerUrl),
  PORT: z.coerce.number().int().positive().default(3000),
  // Packaging/deployment override for the packaged web app root. Local dev
  // usually serves the web app through Vite instead.
  WEB_DIST_DIR: z.string().optional(),
  TRUSTED_ORIGINS: z
    .string()
    .default(defaultPublicServerUrl)
    .transform(normalizeTrustedOrigins),

  // Runtime config file path.
  ALLOY_CONFIG_FILE: z.string().optional(),

  ENCODE_SCRATCH_DIR: z.string().optional(),

  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),

  ALLOY_STORAGE_DRIVER: z.enum(["fs", "s3"]).optional(),
  ALLOY_STORAGE_FS_ROOT: z.string().min(1).optional(),
  ALLOY_STORAGE_FS_PUBLIC_BASE_URL: z
    .url()
    .optional()
    .transform((value) => (value ? normalizePublicServerUrl(value) : value)),
  ALLOY_STORAGE_FS_HMAC_SECRET: z.string().min(32).optional(),
  ALLOY_STORAGE_S3_BUCKET: z.string().optional(),
  ALLOY_STORAGE_S3_REGION: z.string().default("auto"),
  ALLOY_STORAGE_S3_ENDPOINT: z.url().optional(),
  ALLOY_STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  ALLOY_STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  ALLOY_STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  ALLOY_STORAGE_S3_PRESIGN_EXPIRES_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(900),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors
  // eslint-disable-next-line no-console
  console.error(
    "[server/env] Invalid environment variables:\n" +
      JSON.stringify(fieldErrors, null, 2)
  )
  process.exit(1)
}

if (
  parsed.data.NODE_ENV === "production" &&
  isLoopbackHostname(new URL(parsed.data.PUBLIC_SERVER_URL).hostname)
) {
  // eslint-disable-next-line no-console
  console.error(
    "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production."
  )
  process.exit(1)
}

export const env = parsed.data
