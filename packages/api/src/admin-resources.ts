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
  SteamGridDBArtworkResponse,
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
  validateSteamGridDBArtworkResponse,
} from "./contract-validators"
import { blobAsFile } from "./form-file"
import { readJsonOrThrow } from "./http"
import { readDeletedJson, readSuccessJson } from "./mutations"

export type AdminCreateUserInput = {
  username: string
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

export function createAdminResourcesApi(context: ApiContext) {
  const admin = context.rpc.api.admin

  return {
    async fetchUsers(
      options: { cursor?: string; limit?: number; search?: string } = {},
    ): Promise<AdminUsersResponse> {
      const query: AdminUsersQuery = {}
      if (options.cursor) query.cursor = options.cursor
      if (options.limit) query.limit = String(options.limit)
      if (options.search) query.search = options.search
      const res = await admin.users.$get({ query })
      return readJsonOrThrow(res, validateAdminUsersResponse)
    },
    async createUser(
      input: AdminCreateUserInput,
    ): Promise<AdminUserStorageRow> {
      const res = await admin.users.$post({ json: input })
      return readJsonOrThrow(res, validateAdminUserStorageRow)
    },
    async updateUser(
      userId: string,
      input: AdminUpdateUserInput,
    ): Promise<AdminUserStorageRow> {
      const res = await admin.users[":id"].$patch({
        param: { id: userId },
        json: input,
      })
      return readJsonOrThrow(res, validateAdminUserStorageRow)
    },
    async deleteUser(userId: string): Promise<void> {
      const res = await admin.users[":id"].$delete({ param: { id: userId } })
      await readSuccessJson(res)
    },
    async fetchGames(): Promise<AdminGameRow[]> {
      const res = await admin.games.$get()
      return readJsonOrThrow(res, validateAdminGameRows)
    },
    async createGame(input: AdminCreateGameInput): Promise<AdminGameRow> {
      const form: AdminGameCreateForm = { name: input.name }
      if (input.releaseDate) form.releaseDate = input.releaseDate
      if (input.assets?.hero) form.hero = input.assets.hero
      if (input.assets?.grid) form.grid = input.assets.grid
      if (input.assets?.logo) form.logo = input.assets.logo
      if (input.assets?.icon) form.icon = input.assets.icon
      const res = await admin.games.$post({ form })
      return readJsonOrThrow(res, validateAdminGameRow)
    },
    async fetchGameArtwork(
      gameId: string,
      role: GameAssetRole,
    ): Promise<SteamGridDBArtworkResponse> {
      const res = await admin.games[":id"].artwork.$get({
        param: { id: gameId },
        query: { role },
      })
      return readJsonOrThrow(res, validateSteamGridDBArtworkResponse)
    },
    async updateGame(
      gameId: string,
      input: AdminUpdateGameInput,
    ): Promise<AdminGameRow> {
      const res = await admin.games[":id"].$patch({
        param: { id: gameId },
        json: input,
      })
      return readJsonOrThrow(res, validateAdminGameRow)
    },
    async deleteGame(gameId: string): Promise<void> {
      const res = await admin.games[":id"].$delete({ param: { id: gameId } })
      await readDeletedJson(res)
    },
    async uploadGameAsset(
      gameId: string,
      role: GameAssetRole,
      blob: Blob,
    ): Promise<AdminGameRow> {
      const res = await admin.games[":id"].assets[":role"].$post({
        param: { id: gameId, role },
        form: { file: blobAsFile(blob, role) },
      })
      return readJsonOrThrow(res, validateAdminGameRow)
    },
    async fetchWebhooks(): Promise<AdminWebhookRow[]> {
      const res = await admin.webhooks.$get()
      return readJsonOrThrow(res, validateAdminWebhookRows)
    },
    async createWebhook(input: AdminWebhookInput): Promise<AdminWebhookRow> {
      const res = await admin.webhooks.$post({ json: input })
      return readJsonOrThrow(res, validateAdminWebhookRow)
    },
    async updateWebhook(
      webhookId: string,
      input: AdminWebhookPatch,
    ): Promise<AdminWebhookRow> {
      const res = await admin.webhooks[":id"].$patch({
        param: { id: webhookId },
        json: input,
      })
      return readJsonOrThrow(res, validateAdminWebhookRow)
    },
    async deleteWebhook(webhookId: string): Promise<void> {
      const res = await admin.webhooks[":id"].$delete({
        param: { id: webhookId },
      })
      await readDeletedJson(res)
    },
    async testWebhook(webhookId: string): Promise<AdminWebhookTestResult> {
      const res = await admin.webhooks[":id"].test.$post({
        param: { id: webhookId },
      })
      return readJsonOrThrow(res, validateAdminWebhookTestResult)
    },
  }
}
