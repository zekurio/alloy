import "dotenv/config"
import { z } from "zod"

// Deploy-time env only. Anything an admin should be able to change at
// runtime (OAuth provider, open-registrations) lives in `lib/config-store.ts`.

function normalizePublicServerUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:3000"

const EnvSchema = z
  .object({
    DATABASE_URL: z.url(),
    ALLOY_AUTH_SECRET: z.string().min(32).optional(),
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
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    // Runtime config file path. `ALLOY_CONFIG_FILE` is the preferred name;
    // `RUNTIME_CONFIG_PATH` remains as a compatibility alias.
    ALLOY_CONFIG_FILE: z.string().optional(),
    RUNTIME_CONFIG_PATH: z.string().optional(),

    STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
    STORAGE_FS_ROOT: z.string().default("./data/storage"),
    STORAGE_PUBLIC_BASE_URL: z
      .url()
      .default(defaultPublicServerUrl)
      .transform(normalizePublicServerUrl),
    STORAGE_HMAC_SECRET: z.string().optional(),

    // S3 / S3-compatible providers. These only seed runtime config when the
    // runtime config file does not exist yet.
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    S3_PRESIGN_EXPIRES_SEC: z.coerce.number().int().positive().default(900),

    ENCODE_SCRATCH_DIR: z.string().optional(),

    FFMPEG_BIN: z.string().default("ffmpeg"),
    FFPROBE_BIN: z.string().default("ffprobe"),

    CACHE_DRIVER: z.enum(["memory"]).default("memory"),
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.ALLOY_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOY_AUTH_SECRET"],
        message: "ALLOY_AUTH_SECRET must be set and at least 32 chars.",
      })
    }
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

export const authSecret = env.ALLOY_AUTH_SECRET!
