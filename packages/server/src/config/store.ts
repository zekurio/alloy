import { isDeepStrictEqual } from "node:util"

import {
  isObjectRecord,
  RUNTIME_CONFIG_VERSION,
  type ContractJsonValue,
  type OidcClientSecretSource,
  type RuntimeConfig,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { SafeParseResult } from "@alloy/contracts/schema-validation"
import { instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { synchronizeMediaGeneration } from "@alloy/server/queue/media-generation"
import { eq } from "drizzle-orm"

import {
  mergeConfig,
  sectionOverrides,
  valueAtPath,
  type ConfigOverrides,
} from "./overrides"
import {
  CONFIG_SECTION_NAMES,
  configSection,
  type ConfigSectionName,
  type ConfigSectionValues,
} from "./sections"

const logger = createLogger("config-store")

const SetupSettingSchema = t.object({
  setupComplete: t.boolean().$default(false),
})

type SetupSetting = t.infer<typeof SetupSettingSchema>
type StoredSettingValue = (typeof instanceSetting.$inferSelect)["value"]
type SavedOverrides = { [Name in ConfigSectionName]: ConfigOverrides }

const OIDC_CLIENT_SECRET_KEY = "oidcClientSecret"
const DEFAULT_SETUP: SetupSetting = { setupComplete: false }
const NO_OVERRIDES: SavedOverrides = {
  auth: {},
  oidc: {},
  appearance: {},
  transcoding: {},
  uploadLimits: {},
  limits: {},
}

let setupSetting = deepFreeze(DEFAULT_SETUP)
let savedOverrides = deepFreeze(NO_OVERRIDES)
let savedOidcClientSecret: string | null = null
// Built on first read rather than at import: resolving reads env, and
// importing this module must not validate the environment as a side effect.
let values: Readonly<ConfigSectionValues> | null = null
let state: Readonly<RuntimeConfig> | null = null

function currentValues(): Readonly<ConfigSectionValues> {
  return (values ??= deepFreeze(resolveValues()))
}

function currentState(): Readonly<RuntimeConfig> {
  return (state ??= deepFreeze(buildRuntimeConfig(currentValues())))
}

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>,
) => void
const listeners = new Set<Listener>()

function parseSection<Name extends ConfigSectionName>(
  name: Name,
  overrides: ConfigOverrides,
): SafeParseResult<ConfigSectionValues[Name]> {
  return configSection(name).schema.safeParse(
    mergeConfig(env.config.defaults[name], overrides),
  )
}

/**
 * A section's defaults with its saved values on top. Saved values that no
 * longer validate, say after an environment change, are skipped rather than
 * failing startup.
 */
function resolveSection<Name extends ConfigSectionName>(
  name: Name,
  overrides: ConfigOverrides,
): ConfigSectionValues[Name] {
  const parsed = parseSection(name, overrides)
  if (parsed.success) return parsed.data
  logger.error(
    `Ignoring the saved ${name} settings, which no longer validate: ${parsed.error.message}`,
  )
  return env.config.defaults[name]
}

function resolveValues(): ConfigSectionValues {
  return {
    auth: resolveSection("auth", savedOverrides.auth),
    oidc: resolveSection("oidc", savedOverrides.oidc),
    appearance: resolveSection("appearance", savedOverrides.appearance),
    transcoding: resolveSection("transcoding", savedOverrides.transcoding),
    uploadLimits: resolveSection("uploadLimits", savedOverrides.uploadLimits),
    limits: resolveSection("limits", savedOverrides.limits),
  }
}

function buildRuntimeConfig(config: ConfigSectionValues): RuntimeConfig {
  return {
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION,
    openRegistrations: config.auth.openRegistrations,
    setupComplete: setupSetting.setupComplete,
    passkeyEnabled: config.auth.passkeyEnabled,
    requireAuthToBrowse: config.auth.requireAuthToBrowse,
    oidc: config.oidc,
    limits: config.limits,
    uploadLimits: config.uploadLimits,
    storage: env.storage,
    appearance: config.appearance,
    transcoding: config.transcoding,
  }
}

/** What each section resolves to without the values saved in the admin UI. */
export function configDefaults(): Readonly<ConfigSectionValues> {
  return env.config.defaults
}

/**
 * Validate a change to a section without saving it. `base: "current"` lays
 * `input` over the section as it is now, for partial updates. `base:
 * "defaults"` lays it over the defaults, for forms that submit every field
 * they edit: a field the form leaves out goes back to its default.
 */
export function prepareConfigSection<Name extends ConfigSectionName>(
  name: Name,
  input: ContractJsonValue,
  base: "current" | "defaults",
): SafeParseResult<ConfigSectionValues[Name]> {
  const from =
    base === "current" ? currentValues()[name] : env.config.defaults[name]
  return configSection(name).schema.safeParse(mergeConfig(from, input))
}

/**
 * Save a section validated by {@link prepareConfigSection}. Only values that
 * differ from the section's defaults are stored, so saving a default hands
 * that setting back to the environment. Auth and OIDC callers hold
 * `withAdminAccessChange` so the sign-in lockout checks see every write.
 */
export async function saveConfigSection<Name extends ConfigSectionName>(
  name: Name,
  value: ConfigSectionValues[Name],
): Promise<void> {
  const overrides = sectionOverrides(value, env.config.defaults[name])
  await db.transaction(async (tx) => {
    await writeSetting(configSection(name).key, overrides, tx)
    // New clips and the re-encode backlog follow the saved ladder, so the
    // generation moves in the same transaction as the config.
    if (name === "transcoding") {
      await synchronizeMediaGeneration(
        resolveSection("transcoding", overrides),
        tx,
      )
    }
  })
  savedOverrides = deepFreeze({ ...savedOverrides, [name]: overrides })
  refreshState()
}

/**
 * The OIDC client secret change a save makes: a string saves it, null drops
 * the saved one, undefined keeps it.
 */
export type OidcClientSecretChange = string | null | undefined

/** The secret that applies after `change`, or "" when there is none. */
export function oidcClientSecretAfter(change: OidcClientSecretChange): string {
  const saved = change === undefined ? savedOidcClientSecret : change
  return saved || env.config.oidcClientSecret || ""
}

/** The OIDC client secret in use, or "" when none is set. */
export function oidcClientSecret(): string {
  return oidcClientSecretAfter(undefined)
}

export function oidcClientSecretSource(): OidcClientSecretSource | null {
  if (savedOidcClientSecret) return "settings"
  return env.config.oidcClientSecret ? "environment" : null
}

/** Save the OIDC provider and its secret together. */
export async function saveOidcConfig(
  value: ConfigSectionValues["oidc"],
  clientSecret: OidcClientSecretChange,
): Promise<void> {
  const overrides = sectionOverrides(value, env.config.defaults.oidc)
  const nextSecret = savedSecretAfter(clientSecret)
  await db.transaction(async (tx) => {
    await writeSetting(configSection("oidc").key, overrides, tx)
    if (nextSecret === null) {
      await tx
        .delete(instanceSetting)
        .where(eq(instanceSetting.key, OIDC_CLIENT_SECRET_KEY))
    } else {
      await writeSetting(OIDC_CLIENT_SECRET_KEY, nextSecret, tx)
    }
  })
  savedOverrides = deepFreeze({ ...savedOverrides, oidc: overrides })
  savedOidcClientSecret = nextSecret
  refreshState()
}

// A saved secret equal to the environment's is no override, like any other
// default value.
function savedSecretAfter(change: OidcClientSecretChange): string | null {
  const saved = change === undefined ? savedOidcClientSecret : change || null
  return saved === env.config.oidcClientSecret ? null : saved
}

function deepFreeze<T>(value: T): T {
  if (!value || Object(value) !== value || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(Object(value))) {
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
  const prev = currentState()
  values = deepFreeze(resolveValues())
  state = deepFreeze(buildRuntimeConfig(values))
  notify(state, prev)
}

async function readSetting(
  key: string,
): Promise<StoredSettingValue | undefined> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, key))
    .limit(1)
  return row?.value
}

async function writeSetting(
  key: string,
  value: StoredSettingValue,
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

function storedOverrides(
  value: StoredSettingValue | undefined,
): ConfigOverrides {
  return isObjectRecord(value) ? { ...value } : {}
}

/**
 * Load the saved overrides, dropping any that now equal their default (the
 * environment caught up with the admin's choice), and report environment
 * variables that a saved value shadows.
 */
async function loadSection(name: ConfigSectionName): Promise<ConfigOverrides> {
  const section = configSection(name)
  const stored = storedOverrides(await readSetting(section.key))
  const parsed = parseSection(name, stored)
  if (!parsed.success) return stored

  const overrides = sectionOverrides(parsed.data, env.config.defaults[name])
  if (!isDeepStrictEqual(overrides, stored)) {
    await writeSetting(section.key, overrides)
  }
  for (const setting of env.config.settings[name]) {
    if (valueAtPath(overrides, setting.path) !== undefined) {
      logger.info(
        `${setting.name} is set, but a value saved in the admin settings overrides it.`,
      )
    }
  }
  return overrides
}

export async function initializeConfigStore(): Promise<void> {
  const [setupValue, secretValue] = await Promise.all([
    readSetting("setup"),
    readSetting(OIDC_CLIENT_SECRET_KEY),
  ])
  setupSetting = deepFreeze(SetupSettingSchema.parse(setupValue ?? {}))

  const overrides: SavedOverrides = { ...NO_OVERRIDES }
  for (const name of CONFIG_SECTION_NAMES) {
    overrides[name] = await loadSection(name)
  }
  savedOverrides = deepFreeze(overrides)

  const secret = t.string().safeParse(secretValue)
  savedOidcClientSecret = secret.success && secret.data ? secret.data : null
  if (
    savedOidcClientSecret &&
    savedOidcClientSecret === env.config.oidcClientSecret
  ) {
    await db
      .delete(instanceSetting)
      .where(eq(instanceSetting.key, OIDC_CLIENT_SECRET_KEY))
    savedOidcClientSecret = null
  }
  if (savedOidcClientSecret && env.config.oidcClientSecret) {
    logger.info(
      "ALLOY_OIDC_CLIENT_SECRET is set, but a secret saved in the admin settings overrides it.",
    )
  }
  refreshState()
}

interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  setSetupComplete(value: boolean): Promise<void>
  subscribe(fn: Listener): () => void
}

export const configStore: ConfigStore = {
  get(key) {
    return currentState()[key]
  },
  getAll() {
    return structuredClone(currentState())
  },
  async setSetupComplete(value) {
    const next = SetupSettingSchema.parse({ setupComplete: value })
    await writeSetting("setup", next)
    setupSetting = deepFreeze(next)
    refreshState()
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
