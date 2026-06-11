import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateEnumString,
  validateNonNegativeInteger,
  validateNullablePositiveInteger,
  validateOptionalUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateString,
  validateStringArray,
  validateUrlString,
} from "@alloy/api/runtime-validation"
import {
  type AdminRuntimeConfig,
  RUNTIME_CONFIG_VERSION,
  STORAGE_DRIVER_TYPES,
  type RuntimeConfig,
} from "@alloy/contracts"

import { validateAuthProviderColors, validateBackdropTreatment } from "./shared"
const RUNTIME_CONFIG_BOOLEAN_FIELDS = [
  "openRegistrations",
  "setupComplete",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const
const SCHEDULED_TASK_TRIGGER_TYPES = new Set(["startup", "cron"])

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
  for (const key of [
    "discoveryUrl",
    "authorizationUrl",
    "tokenUrl",
    "userInfoUrl",
  ] as const) {
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
  for (const key of ["usernameClaim"] as const) {
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

function validateAdminLimitsConfig(value: unknown) {
  const limits = objectRecord(value, "admin limits config")
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

function validateStorageConfig(value: unknown, label: string) {
  const storage = objectRecord(value, `${label} storage config`)
  validateEnumString(
    storage.driver,
    new Set(STORAGE_DRIVER_TYPES),
    `Invalid ${label} storage config: driver is invalid`,
  )
  validateRequiredString(
    storage.path,
    `Invalid ${label} storage config: path is required`,
  )
  for (const key of ["clipsPath", "usersPath"] as const) {
    const path = storage[key]
    if (path !== null) {
      validateRequiredString(
        path,
        `Invalid ${label} storage config: ${key} must be a string or null`,
      )
    }
  }
  const s3 = objectRecord(storage.s3, `${label} S3 storage config`)
  if (storage.driver === "s3") {
    validateRequiredString(
      s3.bucket,
      `Invalid ${label} S3 storage config: bucket is required`,
    )
    validateRequiredString(
      s3.region,
      `Invalid ${label} S3 storage config: region is required`,
    )
  } else {
    validateString(
      s3.bucket,
      `Invalid ${label} S3 storage config: bucket must be a string`,
    )
    validateString(
      s3.region,
      `Invalid ${label} S3 storage config: region must be a string`,
    )
  }
  if (s3.endpoint !== null) {
    validateUrlString(
      s3.endpoint,
      `Invalid ${label} S3 storage config: endpoint must be a URL or null`,
    )
  }
  validateBoolean(
    s3.forcePathStyle,
    `Invalid ${label} S3 storage config: forcePathStyle must be boolean`,
  )
}

function validateAdminStorageConfig(value: unknown) {
  const storage = objectRecord(value, "admin storage config")
  validateStorageConfig(storage, "admin")
  validateBoolean(
    storage.s3AccessKeyIdSet,
    "Invalid admin storage config: s3AccessKeyIdSet must be boolean",
  )
  validateBoolean(
    storage.s3SecretAccessKeySet,
    "Invalid admin storage config: s3SecretAccessKeySet must be boolean",
  )
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

function validateScheduledTaskTrigger(value: unknown, label: string) {
  const trigger = objectRecord(value, label)
  validateEnumString(
    trigger.type,
    SCHEDULED_TASK_TRIGGER_TYPES,
    `Invalid ${label}: type is invalid`,
  )
  if (trigger.delayMs !== undefined) {
    validateNonNegativeInteger(
      trigger.delayMs,
      `Invalid ${label}: delayMs must be non-negative`,
    )
  }
  if (trigger.type === "cron") {
    validateRequiredString(
      trigger.expression,
      `Invalid ${label}: expression is required`,
    )
  }
}

function validateScheduledTasksConfig(value: unknown, label: string) {
  const scheduledTasks = objectRecord(value, `${label} scheduled tasks`)
  for (const [taskId, triggers] of Object.entries(scheduledTasks)) {
    if (!taskId.trim()) {
      throw new Error(`Invalid ${label} config: scheduled task id is empty`)
    }
    validateArray(
      triggers,
      `Invalid ${label} config: scheduled task triggers must be an array`,
    ).forEach((trigger) =>
      validateScheduledTaskTrigger(trigger, `${label} scheduled task trigger`),
    )
  }
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
    validateRuntimeOAuthProvider(provider, `${label} OAuth provider`),
  )
  validateScheduledTasksConfig(config.scheduledTasks, label)
  validateAdminLimitsConfig(config.limits)
  validateStorageConfig(config.storage, label)
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
  validateAdminStorageConfig(config.storage)
  validateAdminIntegrationsConfig(config.integrations)
  validateUrlString(
    config.authBaseURL,
    "Invalid admin runtime config: authBaseURL must be a URL",
  )
  return value as AdminRuntimeConfig
}
