import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs"
import { basename } from "node:path"

import type { RuntimeConfig } from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { signInConfigError } from "@alloy/server/auth/sign-in-config"
import { CONFIG_PATH } from "@alloy/server/runtime/dirs"
import { errorDetail } from "@alloy/server/runtime/error-message"
import { dirname } from "@alloy/server/runtime/path"

import { bootstrapDefaultConfig, RuntimeConfigSchema } from "./schema"

type LoadResult =
  | {
      ok: true
      config: RuntimeConfig
      created: boolean
      /** Raw parsed JSON as read from disk (null when the file didn't exist). */
      raw: unknown
    }
  | { ok: false; error: string }

type ParseResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; error: string }

function parseRuntimeConfigInput(raw: unknown): ParseResult {
  const result = RuntimeConfigSchema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      error: JSON.stringify(result.error.flatten()),
    }
  }
  return {
    ok: true,
    config: result.data,
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
        raw: null,
      }
    }
  } catch (err) {
    if (isNodeErrorCode(err, "ENOENT")) {
      return {
        ok: true,
        config: bootstrapDefaultConfig(),
        created: true,
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
if (initialLoad.created) {
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
  const authError = await signInConfigError(result.config)
  if (authError) {
    logger.warn(`[config-store] ignoring unsafe ${CONFIG_PATH}:`, authError)
    return false
  }
  apply(result.config, false)
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
