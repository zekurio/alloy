import type {
  AdminRuntimeConfig,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
} from "@alloy/contracts"
import { AdminRuntimeConfigSchema } from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateAdminReEncodeResponse,
  validateAdminUsersResponse,
  validateAdminUserStorageRow,
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
  username?: string
  role?: "user" | "admin"
}

function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  return AdminRuntimeConfigSchema.parse(value)
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

async function updateAppearanceConfig(
  context: ApiContext,
  patch: AppearanceConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.appearance.$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function reEncodeAllClips(
  context: ApiContext,
): Promise<{ enqueued: number; hasMore: boolean }> {
  const res = await context.rpc.api.admin.clips["re-encode"].$post()
  return readJsonOrThrow(res, validateAdminReEncodeResponse)
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
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      updateAppearanceConfig(context, patch),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchUsers: () => fetchUsers(context),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
  }
}
