import type { ApiContext } from "./client"
import type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminStorageConfigPatch,
  AdminUpdateUserStorageQuotaInput,
  AdminUserStorageRow,
  AdminUsersResponse,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import {
  validateAdminRuntimeConfig,
  validateObject,
} from "./contract-validators"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  INTEGRATIONS_REDACTED,
  LOGIN_SPLASH_IMAGE_PATH,
  LOGIN_SPLASH_LAYOUT_VERSION,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  STORAGE_DRIVERS,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminEncoderVariant,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminStorageConfig,
  AdminStorageConfigPatch,
  AdminFsStorageConfig,
  AdminFsStorageConfigPatch,
  AdminS3StorageConfig,
  AdminS3StorageConfigPatch,
  AdminUpdateUserStorageQuotaInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AppearanceConfig,
  EncoderCodec,
  EncoderHwaccel,
  EncoderOpenGraphTarget,
  UsernameClaim,
} from "@workspace/contracts"

type RuntimeConfigPatch = {
  setupComplete?: boolean
  openRegistrations?: boolean
  passkeyEnabled?: boolean
  requireAuthToBrowse?: boolean
}

type AppearanceConfigPatch = {
  loginSplash?: {
    enabled?: boolean
  }
}

async function fetchRuntimeConfig(
  context: ApiContext
): Promise<AdminRuntimeConfig> {
  const res = await context.request("/api/admin/runtime-config")
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateRuntimeConfig(
  context: ApiContext,
  input: RuntimeConfigPatch
): Promise<AdminRuntimeConfig> {
  const res = await context.request("/api/admin/runtime-config", {
    method: "PATCH",
    json: input,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function reloadRuntimeConfig(
  context: ApiContext
): Promise<AdminRuntimeConfig> {
  const res = await context.request("/api/admin/runtime-config/reload", {
    method: "POST",
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function exportRuntimeConfig(context: ApiContext): Promise<unknown> {
  const res = await context.request("/api/admin/runtime-config/export")
  return readJsonOrThrow(res, (value) =>
    validateObject<unknown>(value, "runtime config export")
  )
}

async function importRuntimeConfig(
  context: ApiContext,
  config: unknown
): Promise<AdminRuntimeConfig> {
  const res = await context.request("/api/admin/runtime-config/import", {
    method: "PUT",
    json: config,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function saveOAuthConfig(
  context: ApiContext,
  input: { oauthProvider: AdminOAuthProvider | null }
): Promise<AdminRuntimeConfig> {
  const res = await context.request("/api/admin/oauth-config", {
    method: "PUT",
    json: {
      oauthProvider: input.oauthProvider ? { ...input.oauthProvider } : null,
    },
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function patchRuntimeSection<T>(
  context: ApiContext,
  path: string,
  patch: Partial<T>
): Promise<AdminRuntimeConfig> {
  const res = await context.request(path, {
    method: "PATCH",
    json: patch,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function fetchEncoderCapabilities(
  context: ApiContext
): Promise<AdminEncoderCapabilities> {
  const res = await context.request("/api/admin/encoder/capabilities")
  return readJsonOrThrow(res, (value) =>
    validateObject<AdminEncoderCapabilities>(value, "encoder capabilities")
  )
}

async function reEncodeAllClips(
  context: ApiContext
): Promise<{ enqueued: number; hasMore: boolean }> {
  const res = await context.request("/api/admin/clips/re-encode", {
    method: "POST",
  })
  return readJsonOrThrow(res, (value) =>
    validateObject<{ enqueued: number; hasMore: boolean }>(
      value,
      "re-encode response"
    )
  )
}

async function regenerateLoginSplash(
  context: ApiContext
): Promise<AdminRuntimeConfig> {
  const res = await context.request(
    "/api/admin/appearance/login-splash/regenerate",
    { method: "POST" }
  )
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function fetchUsers(context: ApiContext): Promise<AdminUsersResponse> {
  const res = await context.request("/api/admin/users")
  return readJsonOrThrow(res, (value) =>
    validateObject<AdminUsersResponse>(value, "admin users")
  )
}

async function updateUserStorageQuota(
  context: ApiContext,
  userId: string,
  input: AdminUpdateUserStorageQuotaInput
): Promise<AdminUserStorageRow> {
  const res = await context.request(
    `/api/admin/users/${encodeURIComponent(userId)}/storage-quota`,
    {
      method: "PATCH",
      json: input,
    }
  )
  return readJsonOrThrow(res, (value) =>
    validateObject<AdminUserStorageRow>(value, "admin user storage")
  )
}

export function createAdminApi(context: ApiContext) {
  return {
    fetchRuntimeConfig: () => fetchRuntimeConfig(context),
    updateRuntimeConfig: (input: RuntimeConfigPatch) =>
      updateRuntimeConfig(context, input),
    reloadRuntimeConfig: () => reloadRuntimeConfig(context),
    exportRuntimeConfig: () => exportRuntimeConfig(context),
    importRuntimeConfig: (config: unknown) =>
      importRuntimeConfig(context, config),
    saveOAuthConfig: (input: { oauthProvider: AdminOAuthProvider | null }) =>
      saveOAuthConfig(context, input),
    updateEncoderConfig: (patch: Partial<AdminEncoderConfig>) =>
      patchRuntimeSection(context, "/api/admin/encoder", patch),
    updateLimitsConfig: (patch: Partial<AdminLimitsConfig>) =>
      patchRuntimeSection(context, "/api/admin/limits", patch),
    updateIntegrationsConfig: (patch: Partial<AdminIntegrationsConfig>) =>
      patchRuntimeSection(context, "/api/admin/integrations", patch),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      patchRuntimeSection(context, "/api/admin/appearance", patch),
    regenerateLoginSplash: () => regenerateLoginSplash(context),
    updateStorageConfig: (patch: AdminStorageConfigPatch) =>
      patchRuntimeSection(context, "/api/admin/storage", patch),
    fetchEncoderCapabilities: () => fetchEncoderCapabilities(context),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchUsers: () => fetchUsers(context),
    updateUserStorageQuota: (
      userId: string,
      input: AdminUpdateUserStorageQuotaInput
    ) => updateUserStorageQuota(context, userId, input),
  }
}
