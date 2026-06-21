import {
  AppearanceConfigSchema,
  RUNTIME_CONFIG_VERSION,
  type AppearanceConfig,
  type RuntimeConfig,
} from "@alloy/contracts"
import { instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { eq } from "drizzle-orm"
import { z } from "zod"

const logger = createLogger("config-store")

const SetupSettingSchema = z.object({
  setupComplete: z.boolean().default(false),
})

type SetupSetting = z.infer<typeof SetupSettingSchema>

const DEFAULT_SETUP: SetupSetting = { setupComplete: false }
const DEFAULT_APPEARANCE: AppearanceConfig = AppearanceConfigSchema.parse({
  loginSplash: {
    enabled: false,
    blurPx: 24,
    darkenOpacity: 0.8,
  },
})

type DbOwnedConfigKey = "setupComplete" | "appearance"

let setupSetting = deepFreeze(DEFAULT_SETUP)
let appearanceSetting = deepFreeze(DEFAULT_APPEARANCE)
let state = freezeRuntimeConfig(buildRuntimeConfig())

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>,
) => void
const listeners = new Set<Listener>()

function buildRuntimeConfig(): RuntimeConfig {
  return {
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION,
    openRegistrations: env.openRegistrations,
    setupComplete: setupSetting.setupComplete,
    passkeyEnabled: env.passkeyEnabled,
    requireAuthToBrowse: env.requireAuthToBrowse,
    oauthProviders: env.oauthProviders,
    limits: env.limits,
    storage: env.storage,
    appearance: appearanceSetting,
  }
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

function notify(next: RuntimeConfig, prev: RuntimeConfig): void {
  for (const listener of listeners) {
    try {
      listener(next, prev)
    } catch (err) {
      logger.error("listener threw:", err)
    }
  }
}

function refreshState(): void {
  const prev = state
  state = freezeRuntimeConfig(buildRuntimeConfig())
  notify(state, prev)
}

async function readSetting(key: string): Promise<unknown | undefined> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, key))
    .limit(1)
  return row?.value
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(instanceSetting)
    .values({ key, value, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value, updated_at: new Date() },
    })
}

export async function initializeConfigStore(): Promise<void> {
  const [setupValue, appearanceValue] = await Promise.all([
    readSetting("setup"),
    readSetting("appearance"),
  ])

  setupSetting = deepFreeze(SetupSettingSchema.parse(setupValue ?? {}))
  appearanceSetting = deepFreeze(
    AppearanceConfigSchema.parse(appearanceValue ?? DEFAULT_APPEARANCE),
  )
  refreshState()
}

function assertDbOwnedKey(
  key: keyof RuntimeConfig,
): asserts key is DbOwnedConfigKey {
  if (key !== "setupComplete" && key !== "appearance") {
    throw new Error(
      `Runtime config key "${String(key)}" is declarative and must be set with environment variables or Nix options.`,
    )
  }
}

interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(
    key: K,
    value: RuntimeConfig[K],
  ): Promise<void>
  subscribe(fn: Listener): () => void
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return structuredClone(state)
  },
  async set(key, value) {
    assertDbOwnedKey(key)
    if (key === "setupComplete") {
      const nextSetup = SetupSettingSchema.parse({ setupComplete: value })
      await writeSetting("setup", nextSetup)
      setupSetting = deepFreeze(nextSetup)
      refreshState()
      return
    }

    const nextAppearance = AppearanceConfigSchema.parse(value)
    await writeSetting("appearance", nextAppearance)
    appearanceSetting = deepFreeze(nextAppearance)
    refreshState()
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
