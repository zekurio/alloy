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
  process.env.PUBLIC_SERVER_URL ??
  process.env.BETTER_AUTH_URL ??
  "http://localhost:3000"

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 chars"),
    PUBLIC_SERVER_URL: z
      .string()
      .url()
      .default(defaultPublicServerUrl)
      .transform(normalizePublicServerUrl),
    BETTER_AUTH_URL: z.string().url().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    SERVE_WEB: z.enum(["auto", "true", "false"]).default("auto"),
    WEB_DIST_DIR: z.string().default("../web/dist"),
    TRUSTED_ORIGINS: z
      .string()
      .default(defaultPublicServerUrl)
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    // Optional override for the runtime config file path. Useful for tests and
    // for pointing multiple server processes at a shared mount in production.
    RUNTIME_CONFIG_PATH: z.string().optional(),

    STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
    STORAGE_FS_ROOT: z.string().default("./data/storage"),
    STORAGE_PUBLIC_BASE_URL: z
      .string()
      .url()
      .default(defaultPublicServerUrl)
      .transform(normalizePublicServerUrl),
    STORAGE_HMAC_SECRET: z.string().optional(),

    // S3 / S3-compatible (R2, Tigris, MinIO, …). Only read when STORAGE_DRIVER=s3.
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((v) => v === "true" || v === "1"),
    S3_PRESIGN_EXPIRES_SEC: z.coerce.number().int().positive().default(900),

    ENCODE_SCRATCH_DIR: z.string().optional(),

    FFMPEG_BIN: z.string().default("ffmpeg"),
    FFPROBE_BIN: z.string().default("ffprobe"),

    CACHE_DRIVER: z.enum(["memory"]).default("memory"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === "s3" && !cfg.S3_BUCKET) {
      ctx.addIssue({
        code: "custom",
        path: ["S3_BUCKET"],
        message: "S3_BUCKET is required when STORAGE_DRIVER=s3",
      })
    }
    if (cfg.STORAGE_DRIVER === "fs") {
      if (!cfg.STORAGE_HMAC_SECRET || cfg.STORAGE_HMAC_SECRET.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_HMAC_SECRET"],
          message:
            "STORAGE_HMAC_SECRET must be set and at least 32 chars when STORAGE_DRIVER=fs",
        })
      }
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
