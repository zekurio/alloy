import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"

import { api } from "./api"
import type { ClipRow } from "./clips-api"
import type { GameListRow } from "./games-api"
import { readJsonOrThrow } from "./http-error"

/**
 * Global search — backs the header dropdown. One GET returns matching
 * clips, games, and users so the popover only makes a single round trip
 * per query.
 *
 * The clip/game shapes mirror existing list endpoints (ClipRow /
 * GameListRow) so the dropdown can reuse the same row types without a
 * bespoke projection. Server enforces privacy + readiness filters
 * identical to the public feed, so nothing shows here that wouldn't
 * show on the home page. Users come through as a slim `UserListRow`
 * (id + handle + image + clip count) — just enough to render a row
 * and navigate to the profile page on click.
 */

/**
 * Slim user row for search results. Separate from `PublicUser` because
 * we attach a `clipCount` here for the row subtitle, and because a list
 * row doesn't need the `createdAt` string the profile page consumes.
 */
export interface UserListRow {
  id: string
  username: string
  image: string | null
  /** Count of visible (`ready` + public/unlisted) clips this user owns. */
  clipCount: number
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}

export async function fetchSearch(
  query: string,
  limit = 8
): Promise<SearchResults> {
  const res = await api.api.search.$get({
    query: { q: query, limit: String(limit) },
  })
  return readJsonOrThrow<SearchResults>(res)
}

export const searchKeys = {
  all: ["search"] as const,
  query: (q: string, limit: number) =>
    [...searchKeys.all, { q, limit }] as const,
}

/**
 * Fetch search results for a query. Caller is expected to debounce /
 * defer the input before passing it in — otherwise every keystroke
 * mints a new cache entry. The hook gates itself on a non-empty
 * trimmed query so "empty string" never hits the network.
 *
 * `placeholderData: keepPreviousData` is the anti-flash mechanism:
 * when the deferred query changes the React Query cache key changes
 * too, so `data` would otherwise pop back to `undefined` until the
 * new fetch resolves — flashing the dropdown through its "searching…"
 * skeleton between every key-change. With keepPreviousData the prior
 * result stays visible while the new one is in flight; we surface
 * `isFetching` separately so the row can still show a subtle updating
 * indicator.
 *
 * `staleTime` is short (a few seconds) so typing the same query twice
 * in quick succession doesn't fire a redundant fetch, but fresher data
 * still lands on the next visit to a query the user has already tried.
 */
export function useSearchQuery(
  query: string,
  { enabled = true, limit = 8 }: { enabled?: boolean; limit?: number } = {}
): UseQueryResult<SearchResults> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: searchKeys.query(trimmed, limit),
    queryFn: () => fetchSearch(trimmed, limit),
    enabled: enabled && trimmed.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}
