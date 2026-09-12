import { isStringValue } from "@alloy/contracts"

import { createAdminApi } from "./admin"
import { createAuthConfigApi } from "./auth-config"
import {
  type ApiContext,
  createApiContext,
  type CreateApiOptions,
} from "./client"
import { createClipsApi } from "./clips"
import { createFeedApi } from "./feed"
import { createGamesApi } from "./games"
import { createSearchApi } from "./search"
import { createServerInfoApi } from "./server-info"
import { createTagsApi } from "./tags"
import { createUsersApi } from "./users"

export * from "./admin"
export * from "./auth-config"
export * from "./client"
export * from "./clips"
export * from "./feed"
export * from "./games"
export * from "./http"
export * from "./json-value"
export * from "./paths"
export * from "./search"
export * from "./server-info"
export * from "./tags"
export * from "./users"

export interface AlloyApi extends ApiContext {
  admin: ReturnType<typeof createAdminApi>
  authConfig: ReturnType<typeof createAuthConfigApi>
  clips: ReturnType<typeof createClipsApi>
  feed: ReturnType<typeof createFeedApi>
  games: ReturnType<typeof createGamesApi>
  search: ReturnType<typeof createSearchApi>
  serverInfo: ReturnType<typeof createServerInfoApi>
  tags: ReturnType<typeof createTagsApi>
  users: ReturnType<typeof createUsersApi>
}

export function createApi(
  input: string | CreateApiOptions,
  init?: RequestInit,
): AlloyApi {
  const context = isStringValue(input)
    ? createApiContext({ baseURL: input, init })
    : createApiContext(input)

  return {
    ...context,
    admin: createAdminApi(context),
    authConfig: createAuthConfigApi(context),
    clips: createClipsApi(context),
    feed: createFeedApi(context),
    games: createGamesApi(context),
    search: createSearchApi(context),
    serverInfo: createServerInfoApi(context),
    tags: createTagsApi(context),
    users: createUsersApi(context),
  }
}
