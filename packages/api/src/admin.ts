import type {
  AdminCreateGameInput,
  AdminGameRow,
  AdminRuntimeConfig,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  GameAssetRole,
} from "@alloy/contracts"
import { AdminRuntimeConfigSchema } from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateAdminGameRow,
  validateAdminGameRows,
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
  AdminCreateGameInput,
  AdminGameRow,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminStorageConfig,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AppearanceConfig,
  GameAssetRole,
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

type TranscodingConfigPatch = {
  enable1080p?: boolean
  enable720p?: boolean
  enable480p?: boolean
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

async function updateTranscodingConfig(
  context: ApiContext,
  patch: TranscodingConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.transcoding.$patch({ json: patch })
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

async function fetchGames(context: ApiContext): Promise<AdminGameRow[]> {
  const res = await context.rpc.api.admin.games.$get()
  return readJsonOrThrow(res, validateAdminGameRows)
}

async function createGame(
  context: ApiContext,
  input: AdminCreateGameInput,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games.$post({ json: input })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function updateGame(
  context: ApiContext,
  gameId: string,
  input: AdminUpdateGameInput,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games[":id"].$patch({
    param: { id: gameId },
    json: input,
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function deleteGame(context: ApiContext, gameId: string): Promise<void> {
  const res = await context.rpc.api.admin.games[":id"].$delete({
    param: { id: gameId },
  })
  await readSuccessJson(res)
}

async function uploadGameAsset(
  context: ApiContext,
  gameId: string,
  role: GameAssetRole,
  blob: Blob,
): Promise<AdminGameRow> {
  const file =
    blob instanceof File ? blob : new File([blob], role, { type: blob.type })
  const res = await context.rpc.api.admin.games[":id"].assets[":role"].$post({
    param: { id: gameId, role },
    form: { file },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function deleteGameAsset(
  context: ApiContext,
  gameId: string,
  role: GameAssetRole,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games[":id"].assets[":role"].$delete({
    param: { id: gameId, role },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

export function createAdminApi(context: ApiContext) {
  return {
    fetchRuntimeConfig: () => fetchRuntimeConfig(context),
    updateRuntimeConfig: (input: RuntimeConfigPatch) =>
      updateRuntimeConfig(context, input),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      updateAppearanceConfig(context, patch),
    updateTranscodingConfig: (patch: TranscodingConfigPatch) =>
      updateTranscodingConfig(context, patch),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchUsers: () => fetchUsers(context),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
    fetchGames: () => fetchGames(context),
    createGame: (input: AdminCreateGameInput) => createGame(context, input),
    updateGame: (gameId: string, input: AdminUpdateGameInput) =>
      updateGame(context, gameId, input),
    deleteGame: (gameId: string) => deleteGame(context, gameId),
    uploadGameAsset: (gameId: string, role: GameAssetRole, blob: Blob) =>
      uploadGameAsset(context, gameId, role, blob),
    deleteGameAsset: (gameId: string, role: GameAssetRole) =>
      deleteGameAsset(context, gameId, role),
  }
}
