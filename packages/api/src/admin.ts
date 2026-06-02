import type { ApiContext } from "./client"
import type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminMachineLearningConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminStorageConfigPatch,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  RuntimeConfig,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import { readSuccessJson } from "./mutations"
import { resolvePublicUrl } from "./paths"
import {
  validateAdminEncoderCapabilities,
  validateAdminReEncodeResponse,
  validateAdminRuntimeConfig,
  validateAdminUsersResponse,
  validateAdminUserStorageRow,
  validateRuntimeConfigExport,
} from "./contract-validators"

import { loginSplashImagePath } from "@workspace/contracts"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  INTEGRATIONS_REDACTED,
  LOGIN_SPLASH_IMAGE_PATH,
  LOGIN_SPLASH_LAYOUT_VERSION,
  loginSplashImagePath,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  STORAGE_DRIVERS,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminEncoderVariant,
  AdminFsStorageConfig,
  AdminFsStorageConfigPatch,
  AdminGameClassifierModelConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminMachineLearningConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminS3StorageConfig,
  AdminS3StorageConfigPatch,
  AdminStorageConfig,
  AdminStorageConfigPatch,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AppearanceConfig,
  EncoderCodec,
  EncoderHwaccel,
  RuntimeConfig,
  UsernameClaim,
} from "@workspace/contracts"

export function loginSplashImageUrl(
  origin: string | undefined,
  generatedAt: string | null,
): string {
  return resolvePublicUrl(loginSplashImagePath(generatedAt), origin)
}

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

type AdminCreateUserInput = {
  email: string
  name?: string
  username?: string
  role?: "user" | "admin"
}

async function fetchRuntimeConfig(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$get()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateRuntimeConfig(
  context: ApiContext,
  input: RuntimeConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$patch({
    json: input,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function reloadRuntimeConfig(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].reload.$post()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function exportRuntimeConfig(
  context: ApiContext,
): Promise<RuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].export.$get()
  return readJsonOrThrow(res, validateRuntimeConfigExport)
}

async function importRuntimeConfig(
  context: ApiContext,
  config: unknown,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].import.$put({
    json: config,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function saveOAuthConfig(
  context: ApiContext,
  input: { oauthProviders: AdminOAuthProvider[] },
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["oauth-config"].$put({
    json: {
      oauthProviders: input.oauthProviders.map((provider) => ({ ...provider })),
    },
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

type RuntimeConfigSection =
  | "encoder"
  | "limits"
  | "integrations"
  | "machine-learning"
  | "appearance"
  | "storage"

async function patchRuntimeSection<T>(
  context: ApiContext,
  section: RuntimeConfigSection,
  patch: Partial<T>,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin[section].$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function fetchEncoderCapabilities(
  context: ApiContext,
): Promise<AdminEncoderCapabilities> {
  const res = await context.rpc.api.admin.encoder.capabilities.$get()
  return readJsonOrThrow(res, validateAdminEncoderCapabilities)
}

async function reEncodeAllClips(
  context: ApiContext,
): Promise<{ enqueued: number; hasMore: boolean }> {
  const res = await context.rpc.api.admin.clips["re-encode"].$post()
  return readJsonOrThrow(res, validateAdminReEncodeResponse)
}

async function regenerateLoginSplash(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.appearance["login-splash"].regenerate
    .$post()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function fetchUsers(context: ApiContext): Promise<AdminUsersResponse> {
  const res = await context.rpc.api.admin.users.$get()
  return readJsonOrThrow(res, validateAdminUsersResponse)
}

async function createUser(
  context: ApiContext,
  input: AdminCreateUserInput,
): Promise<AdminUserStorageRow> {
  const res = await context.rpc.api.admin.users.$post({ json: input })
  return readJsonOrThrow(res, validateAdminUserStorageRow)
}

async function updateUser(
  context: ApiContext,
  userId: string,
  input: AdminUpdateUserInput,
): Promise<AdminUserStorageRow> {
  const res = await context.rpc.api.admin.users[":id"].$patch({
    param: { id: userId },
    json: input,
  })
  return readJsonOrThrow(res, validateAdminUserStorageRow)
}

async function deleteUser(context: ApiContext, userId: string): Promise<void> {
  const res = await context.rpc.api.admin.users[":id"].$delete({
    param: { id: userId },
  })
  await readSuccessJson(res)
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
    saveOAuthConfig: (input: { oauthProviders: AdminOAuthProvider[] }) =>
      saveOAuthConfig(context, input),
    updateEncoderConfig: (patch: Partial<AdminEncoderConfig>) =>
      patchRuntimeSection(context, "encoder", patch),
    updateLimitsConfig: (patch: Partial<AdminLimitsConfig>) =>
      patchRuntimeSection(context, "limits", patch),
    updateIntegrationsConfig: (patch: Partial<AdminIntegrationsConfig>) =>
      patchRuntimeSection(context, "integrations", patch),
    updateMachineLearningConfig: (patch: Partial<AdminMachineLearningConfig>) =>
      patchRuntimeSection(context, "machine-learning", patch),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      patchRuntimeSection(context, "appearance", patch),
    regenerateLoginSplash: () => regenerateLoginSplash(context),
    updateStorageConfig: (patch: AdminStorageConfigPatch) =>
      patchRuntimeSection(context, "storage", patch),
    fetchEncoderCapabilities: () => fetchEncoderCapabilities(context),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchUsers: () => fetchUsers(context),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
  }
}
