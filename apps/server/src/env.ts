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
      .map(normalizeOrigin),
  )
  origins.add(normalizeOrigin(defaultPublicServerUrl))
  return [...origins]
}

function isPostgresUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === "postgres:" || protocol === "postgresql:"
  } catch {
    return false
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    isLoopbackIpv4(hostname) ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:2552"

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      isPostgresUrl,
      "DATABASE_URL must be a postgres:// or postgresql:// URL",
    ),
  PUBLIC_SERVER_URL: z
    .url()
    .default(defaultPublicServerUrl)
    .transform(normalizePublicServerUrl),
  PORT: z.coerce.number().int().positive().default(2552),
  // Packaging/deployment override for the packaged web app root. Local dev
  // usually serves the web app through Vite instead.
  WEB_DIST_DIR: z.string().optional(),
  TRUSTED_ORIGINS: z
    .string()
    .default(defaultPublicServerUrl)
    .transform(normalizeTrustedOrigins),

  // App-owned data: config.json, login splash, user avatars/banners, and the
  // ML model cache all live under this dir. Always local; keep it on fast disk.
  ALLOY_DATA_DIR: z.string().optional(),
  // Bulk clip media. The only "big" location; point it at a large volume.
  // Defaults to `${ALLOY_DATA_DIR}/clips`.
  ALLOY_CLIPS_DIR: z.string().optional(),
  // Ephemeral transcode scratch. Defaults to `${ALLOY_DATA_DIR}/encode`; can be
  // pointed at system tmp (e.g. /tmp/alloy) or tmpfs.
  ALLOY_ENCODE_DIR: z.string().optional(),

  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),
})

function readEnv(): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(process.env)

  if (!parsed.success) {
    throw new Error(
      "[server/env] Invalid environment variables:\n" +
        JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    )
  }

  if (
    parsed.data.NODE_ENV === "production" &&
    isLoopbackHostname(new URL(parsed.data.PUBLIC_SERVER_URL).hostname)
  ) {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production.",
    )
  }

  return parsed.data
}

export const env = readEnv()
