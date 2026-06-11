import type {
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminScheduledTaskInfo,
  AdminScheduledTaskPayload,
  AdminScheduledTaskRunResponse,
  AdminScheduledTasksResponse,
  AdminScheduledTaskTrigger,
  AdminStorageConfig,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  RuntimeConfig,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
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

export {
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/contracts"
export type {
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminScheduledTaskPayload,
  AdminScheduledTaskResult,
  AdminScheduledTaskInfo,
  AdminScheduledTaskRunResponse,
  AdminScheduledTasksResponse,
  AdminScheduledTaskTrigger,
  AdminStorageConfig,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AppearanceConfig,
  RuntimeConfig,
  UsernameClaim,
} from "@alloy/contracts"

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

type StorageConfigPatch = Partial<
  Pick<AdminStorageConfig, "clipsPath" | "driver" | "path" | "usersPath">
> & {
  s3?: Partial<AdminStorageConfig["s3"]>
  s3AccessKeyId?: string
  s3SecretAccessKey?: string
}

type AdminCreateUserInput = {
  email: string
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

type RuntimeConfigSection = "limits" | "integrations" | "appearance" | "storage"

async function patchRuntimeSection<T>(
  context: ApiContext,
  section: RuntimeConfigSection,
  patch: Partial<T>,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin[section].$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
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
  payload?: AdminScheduledTaskPayload,
): Promise<AdminScheduledTaskRunResponse> {
  const res = await context.request(
    `/api/admin/scheduled-tasks/${encodeURIComponent(taskId)}/run`,
    {
      method: "POST",
      json: payload === undefined ? undefined : { payload },
    },
  )
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
    updateLimitsConfig: (patch: Partial<AdminLimitsConfig>) =>
      patchRuntimeSection(context, "limits", patch),
    updateStorageConfig: (patch: StorageConfigPatch) =>
      patchRuntimeSection(context, "storage", patch),
    updateIntegrationsConfig: (patch: { steamgriddbApiKey?: string }) =>
      patchRuntimeSection<{ steamgriddbApiKey?: string }>(
        context,
        "integrations",
        patch,
      ),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      patchRuntimeSection(context, "appearance", patch),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchScheduledTasks: () => fetchScheduledTasks(context),
    fetchScheduledTask: (taskId: string) => fetchScheduledTask(context, taskId),
    runScheduledTask: (taskId: string, payload?: AdminScheduledTaskPayload) =>
      runScheduledTask(context, taskId, payload),
    updateScheduledTaskTriggers: (
      taskId: string,
      triggers: AdminScheduledTaskTrigger[],
    ) => updateScheduledTaskTriggers(context, taskId, triggers),
    fetchUsers: () => fetchUsers(context),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
  }
}
