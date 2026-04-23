import { createAdminApi } from "./admin"
import { createAuthConfigApi } from "./auth-config"
import {
  createApiContext,
  type ApiContext,
  type CreateApiOptions,
} from "./client"
import { createClipsApi } from "./clips"
import { createCommentsApi } from "./comments"
import { createFeedApi } from "./feed"
import { createGamesApi } from "./games"
import { createSearchApi } from "./search"
import { createUsersApi } from "./users"

export * from "./admin"
export * from "./auth-config"
export * from "./client"
export * from "./clips"
export * from "./comments"
export * from "./feed"
export * from "./games"
export * from "./http"
export * from "./search"
export * from "./users"

export interface AlloyApi extends ApiContext {
  admin: ReturnType<typeof createAdminApi>
  authConfig: ReturnType<typeof createAuthConfigApi>
  clips: ReturnType<typeof createClipsApi>
  comments: ReturnType<typeof createCommentsApi>
  feed: ReturnType<typeof createFeedApi>
  games: ReturnType<typeof createGamesApi>
  search: ReturnType<typeof createSearchApi>
  users: ReturnType<typeof createUsersApi>
}

export function createApi(baseURL: string, init?: RequestInit): AlloyApi
export function createApi(options: CreateApiOptions): AlloyApi
export function createApi(
  input: string | CreateApiOptions,
  init?: RequestInit
): AlloyApi {
  const context =
    typeof input === "string"
      ? createApiContext({ baseURL: input, init })
      : createApiContext(input)

  return {
    ...context,
    admin: createAdminApi(context),
    authConfig: createAuthConfigApi(context),
    clips: createClipsApi(context),
    comments: createCommentsApi(context),
    feed: createFeedApi(context),
    games: createGamesApi(context),
    search: createSearchApi(context),
    users: createUsersApi(context),
  }
}
