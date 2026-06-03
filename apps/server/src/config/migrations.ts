import { RUNTIME_CONFIG_VERSION } from "@workspace/contracts"

export const CURRENT_RUNTIME_CONFIG_VERSION = RUNTIME_CONFIG_VERSION

const LEGACY_DEFAULT_MACHINE_LEARNING_URLS = new Set([
  "http://localhost:3003",
  "http://localhost:3004",
])

type JsonRecord = Record<string, unknown>

export type RuntimeConfigMigrationResult =
  | { ok: true; config: unknown; migrated: boolean }
  | { ok: false; error: string }

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function cloneRecord(raw: unknown): JsonRecord | null {
  if (!isRecord(raw)) return null
  return structuredClone(raw) as JsonRecord
}

function readConfigVersion(config: JsonRecord): number {
  if (config.runtimeConfigVersion === undefined) return 0
  if (
    typeof config.runtimeConfigVersion !== "number" ||
    !Number.isInteger(config.runtimeConfigVersion) ||
    config.runtimeConfigVersion < 0
  ) {
    return Number.NaN
  }
  return config.runtimeConfigVersion
}

function buildVariantId(name: unknown, usedIds: Set<string>): string {
  const base = typeof name === "string"
    ? name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    : ""
  return normalizeVariantId(base || "variant", usedIds)
}

function normalizeVariantId(raw: string, usedIds: Set<string>): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "variant"
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    const suffixText = `-${suffix}`
    id = `${base.slice(0, 80 - suffixText.length)}${suffixText}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function migrateEncoderConfig(config: JsonRecord): void {
  if (!isRecord(config.encoder)) return
  const encoder = config.encoder
  if (!Array.isArray(encoder.variants)) {
    if (encoder.defaultVariantId === undefined) encoder.defaultVariantId = null
    return
  }

  const usedIds = new Set<string>()
  const variants = encoder.variants.map((rawVariant) => {
    if (!isRecord(rawVariant)) return rawVariant
    const variant = { ...rawVariant }
    if (typeof variant.id !== "string" || variant.id.trim() === "") {
      variant.id = buildVariantId(variant.name, usedIds)
    } else {
      variant.id = normalizeVariantId(variant.id, usedIds)
    }
    if (variant.extraInputArgs === undefined) variant.extraInputArgs = ""
    if (variant.extraOutputArgs === undefined) variant.extraOutputArgs = ""
    return variant
  })
  encoder.variants = variants

  if (encoder.defaultVariantId === undefined) {
    const firstVariant = variants.find(isRecord)
    encoder.defaultVariantId = typeof firstVariant?.id === "string"
      ? firstVariant.id
      : null
  }
}

function migrateMachineLearningConfig(config: JsonRecord): void {
  if (!isRecord(config.machineLearning)) return
  const machineLearning = { ...config.machineLearning }
  if (
    typeof machineLearning.baseUrl === "string" &&
    LEGACY_DEFAULT_MACHINE_LEARNING_URLS.has(machineLearning.baseUrl)
  ) {
    machineLearning.baseUrl = Deno.env.get("MACHINE_LEARNING_URL") ??
      "http://localhost:2662"
  }
  config.machineLearning = machineLearning
}

function migrateLoginSplashConfig(config: JsonRecord): void {
  if (!isRecord(config.appearance)) return
  const appearance = { ...config.appearance }
  if (!isRecord(appearance.loginSplash)) {
    config.appearance = appearance
    return
  }

  appearance.loginSplash = {
    enabled: appearance.loginSplash.enabled === true,
  }
  config.appearance = appearance
}

function migrateUnversionedConfig(config: JsonRecord): void {
  if (config.oauthProviders === undefined) {
    config.oauthProviders = config.oauthProvider ? [config.oauthProvider] : []
  }
  delete config.oauthProvider

  migrateEncoderConfig(config)
  migrateMachineLearningConfig(config)
  migrateLoginSplashConfig(config)

  config.runtimeConfigVersion = CURRENT_RUNTIME_CONFIG_VERSION
}

function migrateVersion1Config(config: JsonRecord): void {
  migrateLoginSplashConfig(config)
  config.runtimeConfigVersion = CURRENT_RUNTIME_CONFIG_VERSION
}

export function migrateRuntimeConfig(
  raw: unknown,
): RuntimeConfigMigrationResult {
  const config = cloneRecord(raw)
  if (!config) {
    return { ok: false, error: "Runtime config must be a JSON object." }
  }

  const version = readConfigVersion(config)
  if (Number.isNaN(version)) {
    return {
      ok: false,
      error: "runtimeConfigVersion must be a non-negative integer.",
    }
  }
  if (version > CURRENT_RUNTIME_CONFIG_VERSION) {
    return {
      ok: false,
      error:
        `runtimeConfigVersion ${version} is newer than supported version ${CURRENT_RUNTIME_CONFIG_VERSION}.`,
    }
  }

  if (version === CURRENT_RUNTIME_CONFIG_VERSION) {
    return { ok: true, config, migrated: false }
  }

  if (version === 0) {
    migrateUnversionedConfig(config)
    return { ok: true, config, migrated: true }
  }

  if (version === 1) {
    migrateVersion1Config(config)
    return { ok: true, config, migrated: true }
  }

  return { ok: true, config, migrated: true }
}
