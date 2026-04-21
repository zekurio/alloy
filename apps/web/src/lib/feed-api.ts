import { api } from "./api"
import type { ClipRow } from "./clips-api"
import { readJsonOrThrow } from "./http-error"

export type FeedFilter =
  | { kind: "foryou" }
  | { kind: "following" }
  | { kind: "game"; gameId: string }

export interface FeedPageParams {
  filter: FeedFilter
  limit?: number
  offset?: number
}

export async function fetchFeed(params: FeedPageParams): Promise<ClipRow[]> {
  const query: Record<string, string> = {
    filter: params.filter.kind,
  }
  if (params.filter.kind === "game") query.gameId = params.filter.gameId
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.offset !== undefined) query.offset = String(params.offset)

  const res = await api.api.feed.$get({ query })
  return readJsonOrThrow<ClipRow[]>(res)
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

export async function fetchFeedChips(): Promise<FeedChipsResponse> {
  const res = await api.api.feed.chips.$get({ query: {} })
  return readJsonOrThrow<FeedChipsResponse>(res)
}
