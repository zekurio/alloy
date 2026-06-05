import {
  type AdminRuntimeConfig,
  ENCODER_HWACCELS,
  RUNTIME_CONFIG_VERSION,
  type RuntimeConfig,
} from "@workspace/contracts"
import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateEnumString,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateOptionalUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateStringArray,
  validateUrlString,
} from "../runtime-validation"
import { validateAuthProviderColors, validateBackdropTreatment } from "./shared"
const ENCODER_HWACCEL_SET: ReadonlySet<string> = new Set(ENCODER_HWACCELS)
const RUNTIME_CONFIG_BOOLEAN_FIELDS = [
  "openRegistrations",
  "setupComplete",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const
const ADMIN_ENCODER_REQUIRED_STRING_FIELDS = [
  "qsvDevice",
  "vaapiDevice",
] as const
const ADMIN_ENCODER_BOOLEAN_FIELDS = [
  `intel${"LowPower"}H264`,
  `intel${"LowPower"}Hevc`,
] as const
function validateRuntimeOAuthProvider(value: unknown, label: string) {
  const provider = objectRecord(value, label)
  for (const key of ["providerId", "displayName", "clientId"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid ${label} config: ${key} is required`,
    )
  }
  if (provider.scopes !== undefined) {
    validateStringArray(
      provider.scopes,
      `Invalid ${label} config: scopes must be an array of strings`,
    )
  }
  validateBoolean(
    provider.enabled,
    `Invalid ${label} config: enabled must be boolean`,
  )
  validateAuthProviderColors(provider, `${label} config`)
  validateOptionalUrlString(
    provider.iconUrl,
    `Invalid ${label} config: iconUrl must be a URL`,
  )
  for (
    const key of [
      "discoveryUrl",
      "authorizationUrl",
      "tokenUrl",
      "userInfoUrl",
    ] as const
  ) {
    validateOptionalUrlString(
      provider[key],
      `Invalid ${label} config: ${key} must be a URL`,
    )
  }
  if (provider.pkce !== undefined) {
    validateBoolean(
      provider.pkce,
      `Invalid ${label} config: pkce must be boolean`,
    )
  }
  for (const key of ["usernameClaim", "displayNameClaim"] as const) {
    if (provider[key] !== undefined) {
      validateRequiredString(
        provider[key],
        `Invalid ${label} config: ${key} must be a non-empty string`,
      )
    }
  }
  for (const key of ["quotaClaim", "roleClaim"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid ${label} config: ${key} is required`,
    )
  }
}

function validateAdminEncoderConfig(value: unknown) {
  const encoder = objectRecord(value, "admin encoder config")
  validateBoolean(
    encoder.enabled,
    "Invalid admin encoder config: enabled must be boolean",
  )
  validateEnumString(
    encoder.hwaccel,
    ENCODER_HWACCEL_SET,
    "Invalid admin encoder config: hwaccel is invalid",
  )
  for (const key of ADMIN_ENCODER_REQUIRED_STRING_FIELDS) {
    validateRequiredString(
      encoder[key],
      `Invalid admin encoder config: ${key} is required`,
    )
  }
  for (const key of ADMIN_ENCODER_BOOLEAN_FIELDS) {
    validateBoolean(
      encoder[key],
      `Invalid admin encoder config: ${key} must be boolean`,
    )
  }
}

function validateAdminLimitsConfig(value: unknown) {
  const limits = objectRecord(value, "admin limits config")
  validatePositiveInteger(
    limits.maxUploadBytes,
    "Invalid admin limits config: maxUploadBytes must be a positive integer",
  )
  validateNullablePositiveInteger(
    limits.defaultStorageQuotaBytes,
    "Invalid admin limits config: defaultStorageQuotaBytes must be a positive integer or null",
  )
  validatePositiveInteger(
    limits.uploadTtlSec,
    "Invalid admin limits config: uploadTtlSec must be a positive integer",
  )
}

function validateAdminIntegrationsConfig(value: unknown) {
  const integrations = objectRecord(value, "admin integrations config")
  validateBoolean(
    integrations.steamgriddbApiKeySet,
    "Invalid admin integrations config: steamgriddbApiKeySet must be boolean",
  )
}

function validateAdminGameClassifierConfig(value: unknown) {
  const gameClassifier = objectRecord(value, "admin game classifier config")
  for (const key of ["modelName", "repoId", "filename", "revision"] as const) {
    validateRequiredString(
      gameClassifier[key],
      `Invalid admin game classifier config: ${key} is required`,
    )
  }
  validateNullableRequiredString(
    gameClassifier.modelVersion,
    "Invalid admin game classifier config: modelVersion must be non-empty or null",
  )
  validateNullableRequiredString(
    gameClassifier.checkpointPath,
    "Invalid admin game classifier config: checkpointPath must be non-empty or null",
  )
}

function validateAdminMachineLearningConfig(value: unknown) {
  const machineLearning = objectRecord(value, "admin machine learning config")
  validateBoolean(
    machineLearning.enabled,
    "Invalid admin machine learning config: enabled must be boolean",
  )
  validateUrlString(
    machineLearning.baseUrl,
    "Invalid admin machine learning config: baseUrl must be a URL",
  )
  validatePositiveInteger(
    machineLearning.requestTimeoutMs,
    "Invalid admin machine learning config: requestTimeoutMs must be a positive integer",
  )
  validateAdminGameClassifierConfig(machineLearning.gameClassifier)
}

function validateAdminAppearanceConfig(value: unknown) {
  const appearance = objectRecord(value, "admin appearance config")
  const loginSplash = objectRecord(
    appearance.loginSplash,
    "admin login splash config",
  )
  validateBoolean(
    loginSplash.enabled,
    "Invalid admin login splash config: enabled must be boolean",
  )
  validateBackdropTreatment(loginSplash, "admin login splash config")
}

/**
 * Shared, secret-free fields common to the exported config and the admin
 * response. Neither shape carries secret values — secrets live server-side.
 */
function validateRuntimeConfigFields(
  config: Record<string, unknown>,
  label: string,
) {
  validatePositiveInteger(
    config.runtimeConfigVersion,
    `Invalid ${label} config: runtimeConfigVersion must be a positive integer`,
  )
  if (config.runtimeConfigVersion !== RUNTIME_CONFIG_VERSION) {
    throw new Error(
      `Invalid ${label} config: runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
    )
  }
  for (const key of RUNTIME_CONFIG_BOOLEAN_FIELDS) {
    validateBoolean(
      config[key],
      `Invalid ${label} config: ${key} must be boolean`,
    )
  }
  validateArray(
    config.oauthProviders,
    `Invalid ${label} config: oauthProviders must be an array`,
  ).map((provider) =>
    validateRuntimeOAuthProvider(provider, `${label} OAuth provider`)
  )
  validateAdminEncoderConfig(config.encoder)
  validateAdminLimitsConfig(config.limits)
  validateAdminMachineLearningConfig(config.machineLearning)
  validateAdminAppearanceConfig(config.appearance)
}

export function validateRuntimeConfigExport(value: unknown): RuntimeConfig {
  const config = objectRecord(value, "runtime config export")
  validateRuntimeConfigFields(config, "runtime config export")
  return value as RuntimeConfig
}

export function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  const config = objectRecord(value, "admin runtime")
  validateRuntimeConfigFields(config, "admin runtime")
  for (const provider of validateArray(config.oauthProviders, "")) {
    validateBoolean(
      objectRecord(provider, "admin OAuth provider").clientSecretSet,
      "Invalid admin runtime config: clientSecretSet must be boolean",
    )
  }
  validateAdminIntegrationsConfig(config.integrations)
  validateUrlString(
    config.authBaseURL,
    "Invalid admin runtime config: authBaseURL must be a URL",
  )
  return value as AdminRuntimeConfig
}
