import {
  createEnv,
  isLoopbackHostname,
  normalizeOrigin,
  normalizePublicServerUrl,
  postgresUrl,
} from "alloy-env"
import { z } from "zod"

// Deploy-time env only. Anything an admin should be able to change at
// runtime (OAuth provider, open-registrations) lives in `config/store.ts`.

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

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:2552"

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: postgresUrl(),
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
  const parsed = createEnv(EnvSchema, { label: "server/env" })

  if (
    parsed.NODE_ENV === "production" &&
    isLoopbackHostname(new URL(parsed.PUBLIC_SERVER_URL).hostname)
  ) {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production.",
    )
  }

  return parsed
}

export const env = readEnv()
