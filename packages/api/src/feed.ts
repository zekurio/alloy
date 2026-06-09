import type {
  FeedChipsResponse,
  FeedPage,
  FeedPageParams,
} from "alloy-contracts"

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
} from "alloy-contracts"

export function createFeedApi(context: ApiContext) {
  return {
    async fetch(params: FeedPageParams): Promise<FeedPage> {
      const res = await context.rpc.api.feed.$get({
        query: queryParams({
          filter: params.filter.kind,
          steamgriddbId:
            params.filter.kind === "game"
              ? params.filter.steamgriddbId
              : undefined,
          tag: params.filter.kind === "hashtag" ? params.filter.tag : undefined,
          limit: params.limit,
          cursor: params.cursor,
        }),
      })
      return readJsonOrThrow(res, validateFeedPage)
    },

    async fetchChips(): Promise<FeedChipsResponse> {
      const res = await context.rpc.api.feed.chips.$get({ query: {} })
      return readJsonOrThrow(res, validateFeedChipsResponse)
    },
  }
}
