import { tmpdir } from "node:os"

import { env } from "@alloy/server/env"

import { resolve } from "./path"

// Resolved, absolute runtime directories. Env-owned storage paths that are
// relative resolve under DATA_DIR; wipeable media cache stays in the OS temp
// area.

function dirFromEnv(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? resolve(value) : fallback
}

/** App-owned mutable data root. */
export const DATA_DIR = dirFromEnv(
  env.ALLOY_DATA_DIR,
  resolve(process.cwd(), "data"),
)

/** Wipeable runtime cache for derived/temporary media work. */
export const MEDIA_CACHE_DIR = resolve(tmpdir(), "alloy-server", "media")
