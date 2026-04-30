import "dotenv/config"
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

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:3000"

const EnvSchema = z.object({
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

  // Runtime config file path. `ALLOY_CONFIG_FILE` is the preferred name;
  // `RUNTIME_CONFIG_PATH` remains as a compatibility alias.
  ALLOY_CONFIG_FILE: z.string().optional(),
  RUNTIME_CONFIG_PATH: z.string().optional(),

  ENCODE_SCRATCH_DIR: z.string().optional(),

  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),

  CACHE_DRIVER: z.enum(["memory"]).default("memory"),
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

export const env = parsed.data
