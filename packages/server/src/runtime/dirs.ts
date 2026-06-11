import { tmpdir } from "node:os"

import { env } from "@alloy/server/env"

import { resolve } from "./path"

// Resolved, absolute runtime directories. Single source of truth so the config
// store and runtime cache never disagree about where app-owned bootstrap data
// lives. Storage roots live in runtime config.

function dirFromEnv(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? resolve(value) : fallback
}

/** App-owned bootstrap data root: config and server secrets. */
export const DATA_DIR = dirFromEnv(
  env.ALLOY_DATA_DIR,
  resolve(process.cwd(), "data"),
)

/** Runtime config file, always alongside the rest of the app data. */
export const CONFIG_PATH = `${DATA_DIR}/config.json`

/** Server secret material, persisted apart from the runtime config. */
export const SECRETS_PATH = `${DATA_DIR}/secrets.json`

/** Wipeable runtime cache for derived/temporary media work. */
export const MEDIA_CACHE_DIR = resolve(tmpdir(), "alloy-server", "media")
