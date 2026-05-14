import fs from "node:fs"
import path from "node:path"

import {
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type RuntimeConfig,
} from "@workspace/contracts"
import { env } from "../env"
import {
  AppearanceConfigPatchSchema,
  EncoderConfigPatchSchema,
  FsStorageConfigPatchSchema,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  RuntimeConfigSchema,
  S3StorageConfigPatchSchema,
  StorageConfigPatchSchema,
  bootstrapDefaultConfig,
} from "./schema"
import {
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  type OAuthProviderSubmission,
} from "./oauth-schema"

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
  AppearanceConfigPatchSchema,
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
  AppearanceConfig,
  IntegrationsConfig,
  LimitsConfig,
  OAuthProviderConfig,
  RuntimeConfig,
  StorageConfig,
} from "@workspace/contracts"

function resolveConfigPath(): string {
  const configuredPath = env.ALLOY_CONFIG_FILE
  if (configuredPath && configuredPath.length > 0) {
    return path.resolve(configuredPath)
  }
  return path.resolve(process.cwd(), "data/runtime-config.json")
}

const CONFIG_PATH = resolveConfigPath()

type LoadResult =
  | { ok: true; config: RuntimeConfig; created: boolean }
  | { ok: false; error: string }

function loadFromDisk(): LoadResult {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      ok: true,
      config: bootstrapDefaultConfig(),
      created: true,
    }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const json = JSON.parse(raw)
    const result = RuntimeConfigSchema.safeParse(json)
    if (!result.success) {
      return {
        ok: false,
        error: JSON.stringify(result.error.flatten()),
      }
    }
    return { ok: true, config: result.data, created: false }
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
  console.error(
    `[config-store] ${CONFIG_PATH} failed validation:`,
    initialLoad.error
  )
  process.exit(1)
}

let state: RuntimeConfig = initialLoad.config
let persistedState: RuntimeConfig = initialLoad.config

const STORAGE_ENV_KEYS = [
  "ALLOY_STORAGE_DRIVER",
  "ALLOY_STORAGE_FS_ROOT",
  "ALLOY_STORAGE_FS_PUBLIC_BASE_URL",
  "ALLOY_STORAGE_FS_HMAC_SECRET",
  "ALLOY_STORAGE_S3_BUCKET",
  "ALLOY_STORAGE_S3_REGION",
  "ALLOY_STORAGE_S3_ENDPOINT",
  "ALLOY_STORAGE_S3_ACCESS_KEY_ID",
  "ALLOY_STORAGE_S3_SECRET_ACCESS_KEY",
  "ALLOY_STORAGE_S3_FORCE_PATH_STYLE",
  "ALLOY_STORAGE_S3_PRESIGN_EXPIRES_SEC",
] as const

export const storageConfigLockedByEnv = STORAGE_ENV_KEYS.some(
  (key) => process.env[key] !== undefined
)

function applyEnvStorageConfig(config: RuntimeConfig): RuntimeConfig {
  if (!storageConfigLockedByEnv) return config

  const next = structuredClone(config)
  const hasFsEnv = STORAGE_ENV_KEYS.some(
    (key) =>
      key.startsWith("ALLOY_STORAGE_FS_") && process.env[key] !== undefined
  )
  const hasS3Env = STORAGE_ENV_KEYS.some(
    (key) =>
      key.startsWith("ALLOY_STORAGE_S3_") && process.env[key] !== undefined
  )

  next.storage.driver =
    env.ALLOY_STORAGE_DRIVER ??
    (hasS3Env && !hasFsEnv ? "s3" : next.storage.driver)

  if (process.env.ALLOY_STORAGE_FS_ROOT !== undefined) {
    next.storage.fs.root = env.ALLOY_STORAGE_FS_ROOT ?? next.storage.fs.root
  }
  if (process.env.ALLOY_STORAGE_FS_PUBLIC_BASE_URL !== undefined) {
    next.storage.fs.publicBaseUrl =
      env.ALLOY_STORAGE_FS_PUBLIC_BASE_URL ?? next.storage.fs.publicBaseUrl
  }
  if (process.env.ALLOY_STORAGE_FS_HMAC_SECRET !== undefined) {
    next.storage.fs.hmacSecret =
      env.ALLOY_STORAGE_FS_HMAC_SECRET ?? next.storage.fs.hmacSecret
  }

  if (process.env.ALLOY_STORAGE_S3_BUCKET !== undefined) {
    next.storage.s3.bucket =
      env.ALLOY_STORAGE_S3_BUCKET ?? next.storage.s3.bucket
  }
  if (
    process.env.ALLOY_STORAGE_S3_REGION !== undefined ||
    next.storage.driver === "s3"
  ) {
    next.storage.s3.region = env.ALLOY_STORAGE_S3_REGION
  }
  if (process.env.ALLOY_STORAGE_S3_ENDPOINT !== undefined) {
    next.storage.s3.endpoint = env.ALLOY_STORAGE_S3_ENDPOINT
  }
  if (process.env.ALLOY_STORAGE_S3_ACCESS_KEY_ID !== undefined) {
    next.storage.s3.accessKeyId = env.ALLOY_STORAGE_S3_ACCESS_KEY_ID
  }
  if (process.env.ALLOY_STORAGE_S3_SECRET_ACCESS_KEY !== undefined) {
    next.storage.s3.secretAccessKey = env.ALLOY_STORAGE_S3_SECRET_ACCESS_KEY
  }
  if (process.env.ALLOY_STORAGE_S3_FORCE_PATH_STYLE !== undefined) {
    next.storage.s3.forcePathStyle = env.ALLOY_STORAGE_S3_FORCE_PATH_STYLE
  }
  if (process.env.ALLOY_STORAGE_S3_PRESIGN_EXPIRES_SEC !== undefined) {
    next.storage.s3.presignExpiresSec = env.ALLOY_STORAGE_S3_PRESIGN_EXPIRES_SEC
  }

  return RuntimeConfigSchema.parse(next)
}

state = applyEnvStorageConfig(state)
if (initialLoad.created) {
  writeToDisk(persistedState)
}

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>
) => void
const listeners = new Set<Listener>()

function apply(
  next: RuntimeConfig,
  persisted: RuntimeConfig,
  persist: boolean
): void {
  const prev = state
  if (persist) writeToDisk(persisted)
  persistedState = persisted
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
  const persisted = storageConfigLockedByEnv
    ? RuntimeConfigSchema.parse({ ...next, storage: persistedState.storage })
    : next
  apply(applyEnvStorageConfig(persisted), persisted, true)
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
  apply(applyEnvStorageConfig(result.config), result.config, false)
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
