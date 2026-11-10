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
import { blobAsFile } from "./form-file"
import { expectOk, readJsonOrThrow } from "./http"

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
      return readJsonOrThrow(res)
    },
    async createUser(
      input: AdminCreateUserInput,
    ): Promise<AdminUserStorageRow> {
      const res = await admin.users.$post({ json: input })
      return readJsonOrThrow(res)
    },
    async updateUser(
      userId: string,
      input: AdminUpdateUserInput,
    ): Promise<AdminUserStorageRow> {
      const res = await admin.users[":id"].$patch({
        param: { id: userId },
        json: input,
      })
      return readJsonOrThrow(res)
    },
    async deleteUser(userId: string): Promise<void> {
      const res = await admin.users[":id"].$delete({ param: { id: userId } })
      await expectOk(res)
    },
    async fetchGames(): Promise<AdminGameRow[]> {
      const res = await admin.games.$get()
      return readJsonOrThrow(res)
    },
    async createGame(input: AdminCreateGameInput): Promise<AdminGameRow> {
      const form: AdminGameCreateForm = { name: input.name }
      if (input.releaseDate) form.releaseDate = input.releaseDate
      if (input.assets?.hero) form.hero = input.assets.hero
      if (input.assets?.grid) form.grid = input.assets.grid
      if (input.assets?.logo) form.logo = input.assets.logo
      if (input.assets?.icon) form.icon = input.assets.icon
      const res = await admin.games.$post({ form })
      return readJsonOrThrow(res)
    },
    async fetchGameArtwork(
      gameId: string,
      role: GameAssetRole,
    ): Promise<SteamGridDBArtworkResponse> {
      const res = await admin.games[":id"].artwork.$get({
        param: { id: gameId },
        query: { role },
      })
      return readJsonOrThrow(res)
    },
    async updateGame(
      gameId: string,
      input: AdminUpdateGameInput,
    ): Promise<AdminGameRow> {
      const res = await admin.games[":id"].$patch({
        param: { id: gameId },
        json: input,
      })
      return readJsonOrThrow(res)
    },
    async deleteGame(gameId: string): Promise<void> {
      const res = await admin.games[":id"].$delete({ param: { id: gameId } })
      await expectOk(res)
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
      return readJsonOrThrow(res)
    },
    async fetchWebhooks(): Promise<AdminWebhookRow[]> {
      const res = await admin.webhooks.$get()
      return readJsonOrThrow(res)
    },
    async createWebhook(input: AdminWebhookInput): Promise<AdminWebhookRow> {
      const res = await admin.webhooks.$post({ json: input })
      return readJsonOrThrow(res)
    },
    async updateWebhook(
      webhookId: string,
      input: AdminWebhookPatch,
    ): Promise<AdminWebhookRow> {
      const res = await admin.webhooks[":id"].$patch({
        param: { id: webhookId },
        json: input,
      })
      return readJsonOrThrow(res)
    },
    async deleteWebhook(webhookId: string): Promise<void> {
      const res = await admin.webhooks[":id"].$delete({
        param: { id: webhookId },
      })
      await expectOk(res)
    },
    async testWebhook(webhookId: string): Promise<AdminWebhookTestResult> {
      const res = await admin.webhooks[":id"].test.$post({
        param: { id: webhookId },
      })
      return readJsonOrThrow(res)
    },
  }
}
