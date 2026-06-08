import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs"
import { basename } from "node:path"

import {
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type RuntimeConfig,
} from "alloy-contracts"
import { logger } from "alloy-logging"

import { signInConfigError } from "../auth/sign-in-config"
import { CONFIG_PATH } from "../runtime/dirs"
import { errorDetail } from "../runtime/error-message"
import { dirname } from "../runtime/path"
import { migrateRuntimeConfig } from "./migrations"
import {
  OAuthProviderSchema,
  OAuthProvidersSchema,
  type OAuthProviderSubmission,
  OAuthProviderSubmissionSchema,
} from "./oauth-schema"
import {
  AppearanceConfigPatchSchema,
  bootstrapDefaultConfig,
  EncoderConfigPatchSchema,
  IntegrationsSecretPatchSchema,
  LimitsConfigPatchSchema,
  MachineLearningConfigPatchSchema,
  RuntimeConfigSchema,
} from "./schema"
// Imported before this module's body runs, so the secret store initializes (and
// seeds itself from any legacy inline secrets in config.json) BEFORE this module
// strips those secret keys and rewrites the file.
import { readInlineSecrets, secretStore } from "./secret-store"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  OAUTH_DISPLAY_NAME_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "alloy-contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "alloy-contracts"

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
  LimitsConfig,
  MachineLearningConfig,
  OAuthProviderConfig,
  RuntimeConfig,
} from "alloy-contracts"

type LoadResult =
  | {
      ok: true
      config: RuntimeConfig
      created: boolean
      migrated: boolean
      strippedSecrets: boolean
      /** Raw parsed JSON as read from disk (null when the file didn't exist). */
      raw: unknown
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
    return config.oauthProviders.some(
      (provider) =>
        Boolean(provider) &&
        typeof provider === "object" &&
        "clientSecret" in (provider as Record<string, unknown>),
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
    if (!statSync(CONFIG_PATH).isFile()) {
      return {
        ok: true,
        config: bootstrapDefaultConfig(),
        created: true,
        migrated: false,
        strippedSecrets: false,
        raw: null,
      }
    }
  } catch (err) {
    if (isNodeErrorCode(err, "ENOENT")) {
      return {
        ok: true,
        config: bootstrapDefaultConfig(),
        created: true,
        migrated: false,
        strippedSecrets: false,
        raw: null,
      }
    }
    return {
      ok: false,
      error: errorDetail(err, "Could not inspect runtime config"),
    }
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf8")
    const json = JSON.parse(raw)
    const result = parseRuntimeConfigInput(json)
    if (!result.ok) return result
    return {
      ok: true,
      config: result.config,
      created: false,
      migrated: result.migrated,
      strippedSecrets: hasLegacySecretKeys(json),
      raw: json,
    }
  } catch (err) {
    return {
      ok: false,
      error: errorDetail(err, "Could not load runtime config"),
    }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(tmpPath, CONFIG_PATH)
}

const initialLoad = loadFromDisk()
if (!initialLoad.ok) {
  logger.error(
    `[config-store] ${CONFIG_PATH} failed validation:`,
    initialLoad.error,
  )
  process.exit(1)
}

let state: RuntimeConfig = initialLoad.config
if (initialLoad.strippedSecrets) {
  // Preserve the pre-split file (secrets and all) before rewriting it without
  // the secret keys, which now live in the secret store.
  try {
    copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`)
    logger.info(
      `[config-store] migrated inline secrets out of ${CONFIG_PATH}; ` +
        `backed up original to ${CONFIG_PATH}.bak`,
    )
  } catch (err) {
    logger.warn("[config-store] could not back up pre-split config:", err)
  }
}
if (
  initialLoad.created ||
  initialLoad.migrated ||
  initialLoad.strippedSecrets
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

async function reloadFromDisk(): Promise<boolean> {
  const result = loadFromDisk()
  if (!result.ok) {
    logger.warn(`[config-store] ignoring invalid ${CONFIG_PATH}:`, result.error)
    return false
  }
  const inline = readInlineSecrets(result.raw)
  const authError = await signInConfigError(
    result.config,
    (providerId) => providerId in inline.oauthClientSecrets,
  )
  if (authError) {
    logger.warn(`[config-store] ignoring unsafe ${CONFIG_PATH}:`, authError)
    return false
  }
  // Migrate any inline admin-managed secrets a hand-edited/restored file
  // carried after validation accepts the reloaded config.
  secretStore.ingestConfigSecrets(result.raw)
  apply(result.config, false)
  if (result.migrated || result.strippedSecrets) writeToDisk(state)
  return true
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null
function startConfigFileWatcher(): void {
  try {
    const fileName = basename(CONFIG_PATH)
    const watcher = watch(dirname(CONFIG_PATH), (_event, changedFileName) => {
      if (changedFileName && changedFileName !== fileName) return
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        reloadTimer = null
        void reloadFromDisk()
      }, 50)
    })
    watcher.on("error", (err) => {
      logger.warn("[config-store] config watcher stopped:", err)
    })
  } catch (err) {
    logger.warn("[config-store] config watcher could not start:", err)
  }
}

startConfigFileWatcher()

interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  replace(value: unknown): void
  reload(): Promise<boolean>
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

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}
