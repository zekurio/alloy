import {
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type RuntimeConfig,
} from "@workspace/contracts"
import { logger } from "@workspace/logging"
import { errorDetail } from "../runtime/error-message"
import { CONFIG_PATH } from "../runtime/dirs"
import { dirname } from "../runtime/path"

// Side-effect import: guarantees the secret store initializes (and seeds itself
// from any legacy inline secrets in config.json) BEFORE this module strips
// those secret keys and rewrites the file.
import "./secret-store"

import {
  AppearanceConfigPatchSchema,
  bootstrapDefaultConfig,
  EncoderConfigPatchSchema,
  IntegrationsSecretPatchSchema,
  LimitsConfigPatchSchema,
  MachineLearningConfigPatchSchema,
  RuntimeConfigSchema,
} from "./schema"
import {
  OAuthProviderSchema,
  OAuthProvidersSchema,
  type OAuthProviderSubmission,
  OAuthProviderSubmissionSchema,
} from "./oauth-schema"
import { migrateRuntimeConfig } from "./migrations"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "@workspace/contracts"

export {
  OAuthProviderSchema,
  OAuthProvidersSchema,
  OAuthProviderSubmissionSchema,
}
export type { OAuthProviderSubmission }
export {
  AppearanceConfigPatchSchema,
  EncoderConfigPatchSchema,
  IntegrationsSecretPatchSchema,
  LimitsConfigPatchSchema,
  MachineLearningConfigPatchSchema,
}

export type {
  AppearanceConfig,
  EncoderCodec,
  EncoderConfig,
  EncoderVariant,
  LimitsConfig,
  MachineLearningConfig,
  OAuthProviderConfig,
  RuntimeConfig,
} from "@workspace/contracts"

type LoadResult =
  | {
    ok: true
    config: RuntimeConfig
    created: boolean
    migrated: boolean
    strippedSecrets: boolean
  }
  | { ok: false; error: string }

/**
 * True when a raw config carries secret keys that have since moved to the
 * secret store. The schema strips them on parse; this flags that we should
 * back up and rewrite the file so they don't linger on disk.
 */
function hasLegacySecretKeys(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  const config = raw as Record<string, unknown>
  if ("secrets" in config || "integrations" in config) return true
  if (Array.isArray(config.oauthProviders)) {
    return config.oauthProviders.some((provider) =>
      Boolean(provider) && typeof provider === "object" &&
      "clientSecret" in (provider as Record<string, unknown>)
    )
  }
  return false
}

type ParseResult =
  | { ok: true; config: RuntimeConfig; migrated: boolean }
  | { ok: false; error: string }

function parseRuntimeConfigInput(raw: unknown): ParseResult {
  const migration = migrateRuntimeConfig(raw)
  if (!migration.ok) return migration

  const result = RuntimeConfigSchema.safeParse(migration.config)
  if (!result.success) {
    return {
      ok: false,
      error: JSON.stringify(result.error.flatten()),
    }
  }
  return {
    ok: true,
    config: result.data,
    migrated: migration.migrated,
  }
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  const result = parseRuntimeConfigInput(value)
  if (!result.ok) throw new Error(result.error)
  return result.config
}

function loadFromDisk(): LoadResult {
  try {
    if (!Deno.statSync(CONFIG_PATH).isFile) {
      return {
        ok: true,
        config: bootstrapDefaultConfig(),
        created: true,
        migrated: false,
        strippedSecrets: false,
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        ok: true,
        config: bootstrapDefaultConfig(),
        created: true,
        migrated: false,
        strippedSecrets: false,
      }
    }
    return {
      ok: false,
      error: errorDetail(err, "Could not inspect runtime config"),
    }
  }

  try {
    const raw = Deno.readTextFileSync(CONFIG_PATH)
    const json = JSON.parse(raw)
    const result = parseRuntimeConfigInput(json)
    if (!result.ok) return result
    return {
      ok: true,
      config: result.config,
      created: false,
      migrated: result.migrated,
      strippedSecrets: hasLegacySecretKeys(json),
    }
  } catch (err) {
    return {
      ok: false,
      error: errorDetail(err, "Could not load runtime config"),
    }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  Deno.mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  Deno.writeTextFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  Deno.renameSync(tmpPath, CONFIG_PATH)
}

const initialLoad = loadFromDisk()
if (!initialLoad.ok) {
  logger.error(
    `[config-store] ${CONFIG_PATH} failed validation:`,
    initialLoad.error,
  )
  Deno.exit(1)
}

let state: RuntimeConfig = initialLoad.config
if (initialLoad.strippedSecrets) {
  // Preserve the pre-split file (secrets and all) before rewriting it without
  // the secret keys, which now live in the secret store.
  try {
    Deno.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`)
    logger.info(
      `[config-store] migrated inline secrets out of ${CONFIG_PATH}; ` +
        `backed up original to ${CONFIG_PATH}.bak`,
    )
  } catch (err) {
    logger.warn("[config-store] could not back up pre-split config:", err)
  }
}
if (
  initialLoad.created || initialLoad.migrated || initialLoad.strippedSecrets
) {
  writeToDisk(state)
}

function freezeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return deepFreeze(config)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

state = freezeRuntimeConfig(state)

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>,
) => void
const listeners = new Set<Listener>()

function apply(next: RuntimeConfig, persist: boolean): void {
  const prev = state
  if (persist) writeToDisk(next)
  state = freezeRuntimeConfig(next)
  for (const listener of listeners) {
    try {
      listener(state, prev)
    } catch (err) {
      logger.error("[config-store] listener threw:", err)
    }
  }
}

function commit(next: RuntimeConfig): void {
  apply(next, true)
}

function reloadFromDisk(): boolean {
  const result = loadFromDisk()
  if (!result.ok) {
    logger.warn(`[config-store] ignoring invalid ${CONFIG_PATH}:`, result.error)
    return false
  }
  apply(result.config, false)
  if (result.migrated) writeToDisk(state)
  return true
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null
function startConfigFileWatcher(): void {
  const watcher = Deno.watchFs(CONFIG_PATH)
  ;(async () => {
    try {
      for await (const event of watcher) {
        if (
          !event.paths.includes(CONFIG_PATH) ||
          (event.kind !== "modify" &&
            event.kind !== "create" &&
            event.kind !== "remove")
        ) {
          continue
        }
        if (reloadTimer) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          reloadTimer = null
          reloadFromDisk()
        }, 50)
      }
    } catch (err) {
      logger.warn("[config-store] config watcher stopped:", err)
    }
  })()
}

startConfigFileWatcher()

interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  replace(value: unknown): void
  reload(): boolean
  subscribe(fn: Listener): () => void
  readonly filePath: string
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return structuredClone(state)
  },
  set(key, value) {
    commit(RuntimeConfigSchema.parse({ ...state, [key]: value }))
  },
  patch(patch) {
    commit(RuntimeConfigSchema.parse({ ...state, ...patch }))
  },
  replace(value) {
    commit(parseRuntimeConfig(value))
  },
  reload() {
    return reloadFromDisk()
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get filePath() {
    return CONFIG_PATH
  },
}
