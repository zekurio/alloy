import type {
  FeedChipsResponse,
  FeedPage,
  FeedPageParams,
  MediaFilter,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"

export type {
  FeedChipsResponse,
  FeedFilter,
  FeedPage,
  FeedPageParams,
} from "@alloy/contracts"

export function createFeedApi(context: ApiContext) {
  return {
    async fetch(params: FeedPageParams): Promise<FeedPage> {
      const res = await context.rpc.api.feed.$get({
        query: queryParams({
          filter: params.filter.kind,
          media: params.filter.media,
          sort: params.sort,
          gameId:
            params.filter.kind === "game" ? params.filter.gameId : undefined,
          authorId:
            params.filter.kind === "game" ? params.filter.authorId : undefined,
          excludeClipId: params.excludeClipId,
          limit: params.limit,
          cursor: params.cursor,
        }),
      })
      return readJsonOrThrow(res)
    },

    async fetchChips(media: MediaFilter = "video"): Promise<FeedChipsResponse> {
      const res = await context.rpc.api.feed.chips.$get({ query: { media } })
      return readJsonOrThrow(res)
    },
  }
}
