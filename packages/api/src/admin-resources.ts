import type {
  AdminCreateGameInput,
  AdminGameRow,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
  AdminWebhookTestResult,
  GameAssetRole,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateAdminGameRow,
  validateAdminGameRows,
  validateAdminUsersResponse,
  validateAdminUserStorageRow,
  validateAdminWebhookRow,
  validateAdminWebhookRows,
  validateAdminWebhookTestResult,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readDeletedJson, readSuccessJson } from "./mutations"

export type AdminCreateUserInput = {
  email: string
  username?: string
  role?: "user" | "admin"
}

type AdminGameCreateForm = {
  name: string
  releaseDate?: string
  hero?: File
  grid?: File
  logo?: File
  icon?: File
}

type AdminUsersQuery = {
  cursor?: string
  limit?: string
  search?: string
}

export async function fetchUsers(
  context: ApiContext,
  options: { cursor?: string; limit?: number; search?: string } = {},
): Promise<AdminUsersResponse> {
  const query: AdminUsersQuery = {}
  if (options.cursor) query.cursor = options.cursor
  if (options.limit) query.limit = String(options.limit)
  if (options.search) query.search = options.search
  const res = await context.rpc.api.admin.users.$get({
    query,
  })
  return readJsonOrThrow(res, validateAdminUsersResponse)
}

export async function createUser(
  context: ApiContext,
  input: AdminCreateUserInput,
): Promise<AdminUserStorageRow> {
  const res = await context.rpc.api.admin.users.$post({ json: input })
  return readJsonOrThrow(res, validateAdminUserStorageRow)
}

export async function updateUser(
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

export async function deleteUser(
  context: ApiContext,
  userId: string,
): Promise<void> {
  const res = await context.rpc.api.admin.users[":id"].$delete({
    param: { id: userId },
  })
  await readSuccessJson(res)
}

export async function fetchGames(context: ApiContext): Promise<AdminGameRow[]> {
  const res = await context.rpc.api.admin.games.$get()
  return readJsonOrThrow(res, validateAdminGameRows)
}

export async function createGame(
  context: ApiContext,
  input: AdminCreateGameInput,
): Promise<AdminGameRow> {
  const form: AdminGameCreateForm = { name: input.name }
  if (input.releaseDate) form.releaseDate = input.releaseDate
  if (input.assets?.hero) form.hero = input.assets.hero
  if (input.assets?.grid) form.grid = input.assets.grid
  if (input.assets?.logo) form.logo = input.assets.logo
  if (input.assets?.icon) form.icon = input.assets.icon
  const res = await context.rpc.api.admin.games.$post({
    form,
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

export async function updateGame(
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

export async function deleteGame(
  context: ApiContext,
  gameId: string,
): Promise<void> {
  const res = await context.rpc.api.admin.games[":id"].$delete({
    param: { id: gameId },
  })
  await readDeletedJson(res)
}

export async function uploadGameAsset(
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

export async function deleteGameAsset(
  context: ApiContext,
  gameId: string,
  role: GameAssetRole,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games[":id"].assets[":role"].$delete({
    param: { id: gameId, role },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

export async function fetchWebhooks(
  context: ApiContext,
): Promise<AdminWebhookRow[]> {
  const res = await context.rpc.api.admin.webhooks.$get()
  return readJsonOrThrow(res, validateAdminWebhookRows)
}

export async function createWebhook(
  context: ApiContext,
  input: AdminWebhookInput,
): Promise<AdminWebhookRow> {
  const res = await context.rpc.api.admin.webhooks.$post({ json: input })
  return readJsonOrThrow(res, validateAdminWebhookRow)
}

export async function updateWebhook(
  context: ApiContext,
  webhookId: string,
  input: AdminWebhookPatch,
): Promise<AdminWebhookRow> {
  const res = await context.rpc.api.admin.webhooks[":id"].$patch({
    param: { id: webhookId },
    json: input,
  })
  return readJsonOrThrow(res, validateAdminWebhookRow)
}

export async function deleteWebhook(
  context: ApiContext,
  webhookId: string,
): Promise<void> {
  const res = await context.rpc.api.admin.webhooks[":id"].$delete({
    param: { id: webhookId },
  })
  await readDeletedJson(res)
}

export async function testWebhook(
  context: ApiContext,
  webhookId: string,
): Promise<AdminWebhookTestResult> {
  const res = await context.rpc.api.admin.webhooks[":id"].test.$post({
    param: { id: webhookId },
  })
  return readJsonOrThrow(res, validateAdminWebhookTestResult)
}
