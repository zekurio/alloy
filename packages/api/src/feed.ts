import type { ApiContext } from "./client"
import type {
  ClipRow,
  FeedChipsResponse,
  FeedPageParams,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  FeedChipGame,
  FeedChipsResponse,
  FeedFilter,
  FeedPageParams,
} from "@workspace/contracts"

export function createFeedApi(context: ApiContext) {
  return {
    async fetch(params: FeedPageParams): Promise<ClipRow[]> {
      const query: Record<string, string> = {
        filter: params.filter.kind,
      }
      if (params.filter.kind === "game") query.gameId = params.filter.gameId
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)

      const res = await context.request("/api/feed", { query })
      return readJsonOrThrow<ClipRow[]>(res)
    },

    async fetchChips(): Promise<FeedChipsResponse> {
      const res = await context.request("/api/feed/chips")
      return readJsonOrThrow<FeedChipsResponse>(res)
    },
  }
}
