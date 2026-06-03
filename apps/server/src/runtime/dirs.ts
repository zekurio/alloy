import { env } from "../env"
import { resolve } from "./path"

// Resolved, absolute runtime directories. Single source of truth so the config
// store, storage drivers, and encode scratch never disagree about where things
// live. See `env.ts` for the knobs.

function dirFromEnv(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? resolve(value) : fallback
}

/** App-owned data root: config, login splash, user assets, ML cache. */
export const DATA_DIR = dirFromEnv(
  env.ALLOY_DATA_DIR,
  resolve(Deno.cwd(), "data"),
)

/** Runtime config file, always alongside the rest of the app data. */
export const CONFIG_PATH = `${DATA_DIR}/config.json`

/** Server secret material, persisted apart from the runtime config. */
export const SECRETS_PATH = `${DATA_DIR}/secrets.json`

/** Bulk clip media root. Defaults under the data dir; override for a big disk. */
export const CLIPS_DIR = dirFromEnv(env.ALLOY_CLIPS_DIR, `${DATA_DIR}/clips`)

/** Ephemeral transcode scratch. Defaults under the data dir; can be tmp/tmpfs. */
export const ENCODE_DIR = dirFromEnv(env.ALLOY_ENCODE_DIR, `${DATA_DIR}/encode`)
