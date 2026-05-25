import type { ApiContext } from "./client"
import type {
  FeedPage,
  FeedChipsResponse,
  FeedPageParams,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import { validateFeedPage, validateObject } from "./contract-validators"

export type {
  FeedChipGame,
  FeedChipsResponse,
  FeedFilter,
  FeedPage,
  FeedPageParams,
} from "@workspace/contracts"

export function createFeedApi(context: ApiContext) {
  return {
    async fetch(params: FeedPageParams): Promise<FeedPage> {
      const query: Record<string, string> = {
        filter: params.filter.kind,
      }
      if (params.filter.kind === "game") query.gameId = params.filter.gameId
      if (params.filter.kind === "hashtag") query.tag = params.filter.tag
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.cursor) query.cursor = params.cursor

      const res = await context.rpc.api.feed.$get({ query })
      return readJsonOrThrow(res, validateFeedPage)
    },

    async fetchChips(): Promise<FeedChipsResponse> {
      const res = await context.rpc.api.feed.chips.$get({ query: {} })
      return readJsonOrThrow(res, (value) =>
        validateObject<FeedChipsResponse>(value, "feed chips")
      )
    },
  }
}
