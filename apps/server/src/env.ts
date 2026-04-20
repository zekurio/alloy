import "dotenv/config"
import { z } from "zod"

// Deploy-time env only. Anything an admin should be able to change at
// runtime (OAuth provider, open-registrations) lives in `lib/config-store.ts`.

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),

  // Optional override for the runtime config file path. Useful for tests and
  // for pointing multiple server processes at a shared mount in production.
  RUNTIME_CONFIG_PATH: z.string().optional(),

  // Storage driver — `fs` is the only implementation today; `s3` slots in
  // here later without touching call sites because the driver interface
  // (apps/server/src/storage/driver.ts) abstracts the difference.
  STORAGE_DRIVER: z.enum(["fs"]).default("fs"),
  // Filesystem root for the `fs` driver. Resolved relative to the server
  // CWD if not absolute. The reaper expects exclusive ownership of this
  // directory — don't share it with other processes.
  STORAGE_FS_ROOT: z.string().default("./data/storage"),
  // Origin the browser uses to POST upload bytes. For the fs driver this
  // points at the same Hono server (it serves /storage/upload/:token). In
  // a split deployment behind a proxy this is the public URL of the API.
  STORAGE_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  // HMAC secret backing the fs driver's upload tokens. Bound to (clipId,
  // userId, key, contentType, maxBytes, expiry); a leak lets an attacker
  // overwrite the source bytes for one specific pending clip — and
  // /finalize then refuses to act on it because authorId mismatches.
  STORAGE_HMAC_SECRET: z
    .string()
    .min(32, "STORAGE_HMAC_SECRET must be at least 32 chars"),

  // ffmpeg binary names — overridable for environments where they're not
  // on PATH. flake.nix pins ffmpeg-headless which provides both. The
  // *behaviour* of the encoder (codec, hwaccel, quality, target height,
  // bitrate, etc.) lives in the runtime config (lib/config-store.ts) and
  // is admin-tunable; only the binary path stays here because it's a
  // deploy-time concern.
  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),

  // Cache driver — backs the view-dedup window (see apps/server/src/cache).
  // `memory` is a single-process in-house Map; `redis` will slot in here
  // later without changing call sites because everything goes through the
  // `Cache` interface. The moment the server runs more than one instance,
  // flip to redis — memory dedup is per-process and would let the same
  // viewer get counted once per instance.
  CACHE_DRIVER: z.enum(["memory"]).default("memory"),
})

// Upload limits (max bytes, ticket TTL), encoder settings (codec, hwaccel,
// quality, target height, audio bitrate), and queue concurrency moved to
// the runtime config. They're admin-toggleable in the settings UI; see
// `RuntimeConfigSchema` in `lib/config-store.ts`.

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  // Format the field errors as a single readable block. Without this, the
  // subsequent `process.exit` can land before Node flushes a multi-arg
  // `console.error` under some runners, and all you see is the exit code.
  const fieldErrors = parsed.error.flatten().fieldErrors
  // eslint-disable-next-line no-console
  console.error(
    "[server/env] Invalid environment variables:\n" +
      JSON.stringify(fieldErrors, null, 2)
  )
  process.exit(1)
}

export const env = parsed.data
