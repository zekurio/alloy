import fs from "node:fs"
import path from "node:path"

import {
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type RuntimeConfig,
} from "@workspace/contracts"
import { env } from "../env"
import {
  DEFAULT_CONFIG,
  EncoderConfigPatchSchema,
  FsStorageConfigPatchSchema,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  RuntimeConfigSchema,
  S3StorageConfigPatchSchema,
  StorageConfigPatchSchema,
  bootstrapDefaultConfig,
} from "./config-schema"
import {
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  type OAuthProviderSubmission,
} from "./config-oauth-schema"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "@workspace/contracts"

export { OAuthProviderSchema, OAuthProviderSubmissionSchema }
export type { OAuthProviderSubmission }
export {
  EncoderConfigPatchSchema,
  FsStorageConfigPatchSchema,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  S3StorageConfigPatchSchema,
  StorageConfigPatchSchema,
}

export type {
  EncoderCodec,
  EncoderConfig,
  EncoderOpenGraphTarget,
  EncoderVariant,
  IntegrationsConfig,
  LimitsConfig,
  OAuthProviderConfig,
  RuntimeConfig,
  StorageConfig,
} from "@workspace/contracts"

function resolveConfigPath(): string {
  const configuredPath = env.ALLOY_CONFIG_FILE ?? env.RUNTIME_CONFIG_PATH
  if (configuredPath && configuredPath.length > 0) {
    return path.resolve(configuredPath)
  }
  return path.resolve(process.cwd(), "data/runtime-config.json")
}

const CONFIG_PATH = resolveConfigPath()

function migrateLegacyFields(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const r = { ...(raw as Record<string, unknown>) }
  if (Array.isArray(r.oauthProviders) && r.oauthProvider === undefined) {
    const first = r.oauthProviders.find(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === "object" && !Array.isArray(p)
    )
    if (first) r.oauthProvider = stripLegacyProviderFields(first)
  }
  if (
    r.oauthProvider &&
    typeof r.oauthProvider === "object" &&
    !Array.isArray(r.oauthProvider)
  ) {
    r.oauthProvider = stripLegacyProviderFields(
      r.oauthProvider as Record<string, unknown>
    )
  }
  if ("oauthProviders" in r) delete r.oauthProviders
  if ("oauthDiscord" in r) delete r.oauthDiscord
  if ("oauthTwitch" in r) delete r.oauthTwitch
  if ("emailPasswordEnabled" in r) delete r.emailPasswordEnabled
  return r
}

function stripLegacyProviderFields(
  p: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...p }
  if (next.displayName === undefined && typeof next.buttonText === "string") {
    next.displayName = next.buttonText
  }
  for (const key of [
    "kind",
    "buttonColor",
    "textColor",
    "icon",
    "buttonText",
  ]) {
    if (key in next) delete next[key]
  }
  return next
}

type LoadResult =
  | { ok: true; config: RuntimeConfig; shouldPersist: boolean }
  | { ok: false; error: string }

function loadFromDisk(): LoadResult {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      ok: true,
      config: bootstrapDefaultConfig(),
      shouldPersist: true,
    }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const json = migrateLegacyFields(JSON.parse(raw))
    const result = RuntimeConfigSchema.safeParse(json)
    if (!result.success) {
      return {
        ok: false,
        error: JSON.stringify(result.error.flatten()),
      }
    }
    return { ok: true, config: result.data, shouldPersist: false }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
  fs.renameSync(tmpPath, CONFIG_PATH)
}

const initialLoad = loadFromDisk()
if (!initialLoad.ok) {
  // eslint-disable-next-line no-console
  console.warn(
    `[config-store] ${CONFIG_PATH} failed validation, falling back to defaults:`,
    initialLoad.error
  )
}

let state: RuntimeConfig = initialLoad.ok ? initialLoad.config : DEFAULT_CONFIG
if (initialLoad.ok && initialLoad.shouldPersist) {
  writeToDisk(state)
}

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>
) => void
const listeners = new Set<Listener>()

function apply(next: RuntimeConfig, persist: boolean): void {
  const prev = state
  if (persist) writeToDisk(next)
  state = next
  for (const listener of listeners) {
    try {
      listener(state, prev)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[config-store] listener threw:", err)
    }
  }
}

function commit(next: RuntimeConfig): void {
  apply(next, true)
}

function reloadFromDisk(): boolean {
  const result = loadFromDisk()
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config-store] ignoring invalid ${CONFIG_PATH}:`,
      result.error
    )
    return false
  }
  apply(result.config, false)
  return true
}

let reloadTimer: NodeJS.Timeout | null = null
function startConfigFileWatcher(): void {
  fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      reloadFromDisk()
    }, 50)
  })
}

startConfigFileWatcher()

export interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  reload(): boolean
  subscribe(fn: Listener): () => void
  readonly filePath: string
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return { ...state }
  },
  set(key, value) {
    commit(RuntimeConfigSchema.parse({ ...state, [key]: value }))
  },
  patch(patch) {
    commit(RuntimeConfigSchema.parse({ ...state, ...patch }))
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
