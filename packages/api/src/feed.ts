import type { ApiContext } from "./client"
import type { ClipRow } from "./clips"
import { readJsonOrThrow } from "./http"

export type FeedFilter =
  | { kind: "foryou" }
  | { kind: "following" }
  | { kind: "game"; gameId: string }

export interface FeedPageParams {
  filter: FeedFilter
  limit?: number
  offset?: number
}

export interface FeedChipGame {
  id: string
  slug: string
  name: string
  iconUrl: string | null
  logoUrl: string | null
  interaction: number
  clipCount: number
}

export interface FeedChipsResponse {
  games: FeedChipGame[]
}

export function createFeedApi(context: ApiContext) {
  return {
    async fetch(params: FeedPageParams): Promise<ClipRow[]> {
      const query: Record<string, string> = {
        filter: params.filter.kind,
      }
      if (params.filter.kind === "game") query.gameId = params.filter.gameId
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)

      const res = await context.client.api.feed.$get({ query })
      return readJsonOrThrow<ClipRow[]>(res)
    },

    async fetchChips(): Promise<FeedChipsResponse> {
      const res = await context.client.api.feed.chips.$get({ query: {} })
      return readJsonOrThrow<FeedChipsResponse>(res)
    },
  }
}
