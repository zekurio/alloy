import { createAdminApi } from "./admin"
import { createAuthConfigApi } from "./auth-config"
import {
  type ApiContext,
  createApiContext,
  type CreateApiOptions,
} from "./client"
import { createClipsApi } from "./clips"
import { createCommentsApi } from "./comments"
import { createFeedApi } from "./feed"
import { createGamesApi } from "./games"
import { createNotificationsApi } from "./notifications"
import { createSearchApi } from "./search"
import { createStagingApi } from "./staging"
import { createTagsApi } from "./tags"
import { createUsersApi } from "./users"

export * from "./admin"
export * from "./auth-config"
export * from "./client"
export * from "./clips"
export * from "./comments"
export * from "./feed"
export * from "./games"
export * from "./http"
export * from "./notifications"
export * from "./paths"
export * from "./search"
export * from "./staging"
export * from "./tags"
export * from "./users"

export interface AlloyApi extends ApiContext {
  admin: ReturnType<typeof createAdminApi>
  authConfig: ReturnType<typeof createAuthConfigApi>
  clips: ReturnType<typeof createClipsApi>
  comments: ReturnType<typeof createCommentsApi>
  feed: ReturnType<typeof createFeedApi>
  games: ReturnType<typeof createGamesApi>
  notifications: ReturnType<typeof createNotificationsApi>
  search: ReturnType<typeof createSearchApi>
  staging: ReturnType<typeof createStagingApi>
  tags: ReturnType<typeof createTagsApi>
  users: ReturnType<typeof createUsersApi>
}

export function createApi(
  input: string | CreateApiOptions,
  init?: RequestInit,
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
    notifications: createNotificationsApi(context),
    search: createSearchApi(context),
    staging: createStagingApi(context),
    tags: createTagsApi(context),
    users: createUsersApi(context),
  }
}
