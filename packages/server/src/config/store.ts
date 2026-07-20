import {
  AppearanceConfigSchema,
  JobsConfigSchema,
  RUNTIME_CONFIG_VERSION,
  TranscodingConfigSchema,
  type AppearanceConfig,
  type AuthConfigLocks,
  type JobsConfig,
  type OAuthProviderConfig,
  type RuntimeConfig,
  type TranscodingConfig,
} from "@alloy/contracts"
import { instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { OAuthProvidersSchema } from "./oauth-schema"

const logger = createLogger("config-store")

const SetupSettingSchema = z.object({
  setupComplete: z.boolean().default(false),
})

type SetupSetting = z.infer<typeof SetupSettingSchema>

// DB-side auth toggles. Each key is only consulted when its ALLOY_* env
// variable is unset; the schema defaults double as the instance defaults.
const AuthTogglesSchema = z.object({
  openRegistrations: z.boolean().default(false),
  passkeyEnabled: z.boolean().default(true),
  requireAuthToBrowse: z.boolean().default(true),
})

type AuthToggles = z.infer<typeof AuthTogglesSchema>

const DEFAULT_SETUP: SetupSetting = { setupComplete: false }
const DEFAULT_AUTH: AuthToggles = AuthTogglesSchema.parse({})
const DEFAULT_APPEARANCE: AppearanceConfig = AppearanceConfigSchema.parse({
  loginSplash: {
    enabled: false,
    blurPx: 24,
    darkenOpacity: 0.8,
  },
})
const DEFAULT_TRANSCODING: TranscodingConfig = TranscodingConfigSchema.parse({})
const DEFAULT_JOBS: JobsConfig = JobsConfigSchema.parse({})

type DbOwnedConfigKey = "setupComplete" | "appearance" | "transcoding" | "jobs"

let setupSetting = deepFreeze(DEFAULT_SETUP)
let authSetting = deepFreeze(DEFAULT_AUTH)
let oauthProvidersSetting: readonly OAuthProviderConfig[] = deepFreeze([])
let oauthClientSecretsSetting: Readonly<Record<string, string>> = deepFreeze({})
let appearanceSetting = deepFreeze(DEFAULT_APPEARANCE)
let transcodingSetting = deepFreeze(DEFAULT_TRANSCODING)
let jobsSetting = deepFreeze(DEFAULT_JOBS)
let state = freezeRuntimeConfig(buildRuntimeConfig())

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>,
) => void
const listeners = new Set<Listener>()

function buildRuntimeConfig(): RuntimeConfig {
  return {
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION,
    openRegistrations:
      env.authEnv.openRegistrations ?? authSetting.openRegistrations,
    setupComplete: setupSetting.setupComplete,
    passkeyEnabled: env.authEnv.passkeyEnabled ?? authSetting.passkeyEnabled,
    requireAuthToBrowse:
      env.authEnv.requireAuthToBrowse ?? authSetting.requireAuthToBrowse,
    oauthProviders: env.authEnv.oauthProviders ?? [...oauthProvidersSetting],
    limits: env.limits,
    storage: env.storage,
    appearance: appearanceSetting,
    transcoding: transcodingSetting,
    jobs: jobsSetting,
  }
}

/** Which auth config sections are env-managed (admin writes rejected). */
export function authEnvLocks(): AuthConfigLocks {
  return {
    openRegistrations: env.authEnv.openRegistrations !== null,
    passkeyEnabled: env.authEnv.passkeyEnabled !== null,
    requireAuthToBrowse: env.authEnv.requireAuthToBrowse !== null,
    oauthProviders: env.authEnv.oauthProviders !== null,
  }
}

const AUTH_TOGGLE_ENV_NAMES = {
  openRegistrations: "ALLOY_OPEN_REGISTRATIONS",
  passkeyEnabled: "ALLOY_PASSKEY_ENABLED",
  requireAuthToBrowse: "ALLOY_REQUIRE_AUTH_TO_BROWSE",
} as const

export async function setAuthToggles(
  patch: Partial<AuthToggles>,
): Promise<void> {
  const locks = authEnvLocks()
  for (const key of Object.keys(AUTH_TOGGLE_ENV_NAMES) as Array<
    keyof typeof AUTH_TOGGLE_ENV_NAMES
  >) {
    if (patch[key] !== undefined && locks[key]) {
      throw new Error(
        `This setting is managed by the ${AUTH_TOGGLE_ENV_NAMES[key]} environment variable. Unset it to edit the setting here.`,
      )
    }
  }

  const next = AuthTogglesSchema.parse({ ...authSetting, ...patch })
  await writeSetting("auth", next)
  authSetting = deepFreeze(next)
  refreshState()
}

/**
 * Replace the stored OAuth provider list. `secrets` carries new client secrets
 * by provider id; providers absent from it keep their stored secret, and
 * secrets for removed providers are pruned.
 */
export async function setOAuthProviders(
  providers: OAuthProviderConfig[],
  secrets: Record<string, string>,
): Promise<void> {
  if (env.authEnv.oauthProviders !== null) {
    throw new Error(
      "OAuth providers are managed by the ALLOY_SOCIALACCOUNT_PROVIDERS environment variable. Unset it to edit providers here.",
    )
  }

  const nextProviders = OAuthProvidersSchema.parse(providers)
  const nextSecrets: Record<string, string> = {}
  for (const provider of nextProviders) {
    const incoming = secrets[provider.providerId]
    const kept = oauthClientSecretsSetting[provider.providerId]
    const value = incoming ?? kept
    if (value) nextSecrets[provider.providerId] = value
  }

  // One transaction: a failure between the two writes must not leave a new
  // provider list paired with a stale (or already-pruned) secret map.
  await db.transaction(async (tx) => {
    await writeSetting("oauthProviders", nextProviders, tx)
    await writeSetting("oauthClientSecrets", nextSecrets, tx)
  })
  oauthProvidersSetting = deepFreeze(nextProviders)
  oauthClientSecretsSetting = deepFreeze(nextSecrets)
  refreshState()
}

/**
 * Resolve an OAuth client secret ("" when unset) from whichever source owns
 * the provider list: the env JSON when ALLOY_SOCIALACCOUNT_PROVIDERS is set,
 * the settings table otherwise. Consumed via the secret-store facade.
 */
export function storedOAuthClientSecret(providerId: string): string {
  if (env.authEnv.oauthClientSecrets !== null) {
    return env.authEnv.oauthClientSecrets[providerId] ?? ""
  }
  return oauthClientSecretsSetting[providerId] ?? ""
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

async function writeSetting(
  key: string,
  value: unknown,
  executor: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await executor
    .insert(instanceSetting)
    .values({ key, value, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value, updated_at: new Date() },
    })
}

export async function initializeConfigStore(): Promise<void> {
  const [
    setupValue,
    authValue,
    oauthProvidersValue,
    oauthClientSecretsValue,
    appearanceValue,
    transcodingValue,
    jobsValue,
  ] = await Promise.all([
    readSetting("setup"),
    readSetting("auth"),
    readSetting("oauthProviders"),
    readSetting("oauthClientSecrets"),
    readSetting("appearance"),
    readSetting("transcoding"),
    readSetting("jobs"),
  ])

  setupSetting = deepFreeze(SetupSettingSchema.parse(setupValue ?? {}))
  authSetting = deepFreeze(AuthTogglesSchema.parse(authValue ?? {}))
  oauthProvidersSetting = deepFreeze(
    OAuthProvidersSchema.parse(oauthProvidersValue ?? []),
  )
  oauthClientSecretsSetting = deepFreeze(
    z.record(z.string(), z.string()).parse(oauthClientSecretsValue ?? {}),
  )
  appearanceSetting = deepFreeze(
    AppearanceConfigSchema.parse(appearanceValue ?? DEFAULT_APPEARANCE),
  )
  transcodingSetting = deepFreeze(
    TranscodingConfigSchema.parse(transcodingValue ?? DEFAULT_TRANSCODING),
  )
  jobsSetting = deepFreeze(JobsConfigSchema.parse(jobsValue ?? DEFAULT_JOBS))
  refreshState()
}

function assertDbOwnedKey(
  key: keyof RuntimeConfig,
): asserts key is DbOwnedConfigKey {
  if (
    key !== "setupComplete" &&
    key !== "appearance" &&
    key !== "transcoding" &&
    key !== "jobs"
  ) {
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

    if (key === "appearance") {
      const nextAppearance = AppearanceConfigSchema.parse(value)
      await writeSetting("appearance", nextAppearance)
      appearanceSetting = deepFreeze(nextAppearance)
      refreshState()
      return
    }

    if (key === "jobs") {
      const nextJobs = JobsConfigSchema.parse(value)
      await writeSetting("jobs", nextJobs)
      jobsSetting = deepFreeze(nextJobs)
      refreshState()
      return
    }

    const nextTranscoding = TranscodingConfigSchema.parse(value)
    await writeSetting("transcoding", nextTranscoding)
    transcodingSetting = deepFreeze(nextTranscoding)
    refreshState()
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
