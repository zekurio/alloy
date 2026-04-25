import type { ApiContext } from "./client"
import type {
  FeedPage,
  FeedChipsResponse,
  FeedPageParams,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

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
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.cursor) query.cursor = params.cursor

      const res = await context.request("/api/feed", { query })
      return readJsonOrThrow<FeedPage>(res)
    },

    async fetchChips(): Promise<FeedChipsResponse> {
      const res = await context.request("/api/feed/chips")
      return readJsonOrThrow<FeedChipsResponse>(res)
    },
  }
}
