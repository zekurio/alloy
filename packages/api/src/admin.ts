import type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminLimitsConfig,
  AdminMachineLearningConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminScheduledTaskInfo,
  AdminScheduledTaskRunResponse,
  AdminScheduledTasksResponse,
  AdminScheduledTaskTrigger,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  RuntimeConfig,
} from "alloy-contracts"
import { loginSplashImagePath } from "alloy-contracts"

import type { ApiContext } from "./client"
import {
  validateAdminEncoderCapabilities,
  validateAdminReEncodeResponse,
  validateAdminRuntimeConfig,
  validateAdminScheduledTaskInfo,
  validateAdminScheduledTaskRunResponse,
  validateAdminScheduledTasksResponse,
  validateAdminUsersResponse,
  validateAdminUserStorageRow,
  validateRuntimeConfigExport,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readSuccessJson } from "./mutations"
import { resolvePublicUrl } from "./paths"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  ENCODER_TONEMAPPING_ALGORITHMS,
  ENCODER_TONEMAPPING_MODES,
  ENCODER_TONEMAPPING_RANGES,
  LOGIN_SPLASH_IMAGE_PATH,
  loginSplashImagePath,
  OAUTH_DISPLAY_NAME_CLAIM_DEFAULT,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "alloy-contracts"
export type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminGameClassifierModelConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminMachineLearningConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminScheduledTaskResult,
  AdminScheduledTaskInfo,
  AdminScheduledTaskRunResponse,
  AdminScheduledTasksResponse,
  AdminScheduledTaskTrigger,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AppearanceConfig,
  DisplayNameClaim,
  EncoderCodec,
  EncoderHwaccel,
  EncoderTonemappingAlgorithm,
  EncoderTonemappingMode,
  EncoderTonemappingRange,
  RuntimeConfig,
  UsernameClaim,
} from "alloy-contracts"

export function loginSplashImageUrl(origin: string | undefined): string {
  return resolvePublicUrl(loginSplashImagePath(), origin)
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
    blurPx?: number
    darkenOpacity?: number
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

async function fetchScheduledTasks(
  context: ApiContext,
): Promise<AdminScheduledTasksResponse> {
  const res = await context.rpc.api.admin["scheduled-tasks"].$get()
  return readJsonOrThrow(res, validateAdminScheduledTasksResponse)
}

async function fetchScheduledTask(
  context: ApiContext,
  taskId: string,
): Promise<AdminScheduledTaskInfo> {
  const res = await context.rpc.api.admin["scheduled-tasks"][":id"].$get({
    param: { id: taskId },
  })
  return readJsonOrThrow(res, validateAdminScheduledTaskInfo)
}

async function runScheduledTask(
  context: ApiContext,
  taskId: string,
): Promise<AdminScheduledTaskRunResponse> {
  const res = await context.rpc.api.admin["scheduled-tasks"][":id"].run.$post({
    param: { id: taskId },
  })
  return readJsonOrThrow(res, validateAdminScheduledTaskRunResponse)
}

async function updateScheduledTaskTriggers(
  context: ApiContext,
  taskId: string,
  triggers: AdminScheduledTaskTrigger[],
): Promise<AdminScheduledTaskInfo> {
  const res = await context.rpc.api.admin["scheduled-tasks"][
    ":id"
  ].triggers.$put({
    param: { id: taskId },
    json: { triggers },
  })
  return readJsonOrThrow(res, validateAdminScheduledTaskInfo)
}

async function regenerateLoginSplash(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res =
    await context.rpc.api.admin.appearance["login-splash"].regenerate.$post()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function uploadLoginSplash(
  context: ApiContext,
  file: File,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.appearance[
    "login-splash"
  ].upload.$post({
    form: { file },
  })
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
    updateIntegrationsConfig: (patch: { steamgriddbApiKey?: string }) =>
      patchRuntimeSection<{ steamgriddbApiKey?: string }>(
        context,
        "integrations",
        patch,
      ),
    updateMachineLearningConfig: (patch: Partial<AdminMachineLearningConfig>) =>
      patchRuntimeSection(context, "machine-learning", patch),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      patchRuntimeSection(context, "appearance", patch),
    regenerateLoginSplash: () => regenerateLoginSplash(context),
    uploadLoginSplash: (file: File) => uploadLoginSplash(context, file),
    fetchEncoderCapabilities: () => fetchEncoderCapabilities(context),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchScheduledTasks: () => fetchScheduledTasks(context),
    fetchScheduledTask: (taskId: string) => fetchScheduledTask(context, taskId),
    runScheduledTask: (taskId: string) => runScheduledTask(context, taskId),
    updateScheduledTaskTriggers: (
      taskId: string,
      triggers: AdminScheduledTaskTrigger[],
    ) => updateScheduledTaskTriggers(context, taskId, triggers),
    runClipStorageMaintenance: () =>
      runScheduledTask(context, "clip-storage-maintenance"),
    fetchUsers: () => fetchUsers(context),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
  }
}
