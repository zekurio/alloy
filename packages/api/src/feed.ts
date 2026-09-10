import type {
  FeedChipsResponse,
  FeedPage,
  FeedPageParams,
  MediaFilter,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateFeedChipsResponse,
  validateFeedPage,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"

export type {
  FeedChipGame,
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
          limit: params.limit,
          cursor: params.cursor,
        }),
      })
      const page = await readJsonOrThrow(res, validateFeedPage)
      // Older servers ignore the additive media filter and return video rows.
      if (
        params.filter.media === "image" &&
        page.items.some((row) => row.mediaKind !== "image")
      )
        return { items: [], nextCursor: null }
      return page
    },

    async fetchChips(media: MediaFilter = "video"): Promise<FeedChipsResponse> {
      const res = await context.rpc.api.feed.chips.$get({ query: { media } })
      return readJsonOrThrow(res, validateFeedChipsResponse)
    },
  }
}
