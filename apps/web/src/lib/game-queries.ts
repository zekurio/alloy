import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"

import type { ClipRow } from "./clips-api"
import {
  fetchGame,
  fetchGameClips,
  fetchGames,
  fetchGameTopClips,
  fetchSteamGridDBStatus,
  resolveGame,
  searchGames,
  type GameClipsParams,
  type GameListRow,
  type GameRow,
  type SteamGridDBSearchResult,
} from "./games-api"

export const gameKeys = {
  all: ["games"] as const,
  /** Boolean `steamgriddbConfigured` — mount check for the upload picker. */
  status: () => [...gameKeys.all, "status"] as const,
  /** SGDB autocomplete proxy — branches per normalised query string. */
  search: (query: string) => [...gameKeys.all, "search", query] as const,
  /** `/games` landscape grid. One global cache entry. */
  list: () => [...gameKeys.all, "list"] as const,
  /** Per-slug detail for the banner header on `/g/:slug`. */
  detail: (slug: string) => [...gameKeys.all, "detail", slug] as const,
  clips: (slug: string, params: GameClipsParams) =>
    [...gameKeys.all, "clips", slug, params] as const,
  /** Weighted top strip on the game detail page. */
  topClips: (slug: string, limit: number) =>
    [...gameKeys.all, "topClips", slug, { limit }] as const,
}

export function useSteamGridDBStatusQuery(): UseQueryResult<{
  steamgriddbConfigured: boolean
}> {
  return useQuery({
    queryKey: gameKeys.status(),
    queryFn: fetchSteamGridDBStatus,
    // 5-minute freshness is plenty for a config flag; the admin save
    // path explicitly invalidates so a toggle reflects immediately.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useSearchGamesQuery(
  query: string,
  { enabled = true }: { enabled?: boolean } = {}
): UseQueryResult<SteamGridDBSearchResult[]> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: gameKeys.search(trimmed),
    queryFn: () => searchGames(trimmed),
    // Empty query short-circuits to [] server-side but we still gate the
    // hook to avoid the round trip entirely.
    enabled: enabled && trimmed.length > 0,
    staleTime: 30_000,
    // SGDB is the upstream — no point re-hitting on window focus.
    refetchOnWindowFocus: false,
    // Autocomplete doesn't want to thrash on transient network blips —
    // a single retry is enough, the user will type again if it's still bad.
    retry: 1,
  })
}

export function useResolveGameMutation() {
  return useMutation<GameRow, Error, { steamgriddbId: number }>({
    mutationFn: ({ steamgriddbId }) => resolveGame(steamgriddbId),
  })
}

export function useGamesListQuery(): UseQueryResult<GameListRow[]> {
  return useQuery({
    queryKey: gameKeys.list(),
    queryFn: fetchGames,
    // Clip uploads nudge this indirectly (new game → new row). 60s is a
    // decent balance between freshness and not hammering on tab flips.
    staleTime: 60_000,
  })
}

export function useGameQuery(slug: string): UseQueryResult<GameRow> {
  return useQuery({
    queryKey: gameKeys.detail(slug),
    queryFn: () => fetchGame(slug),
    enabled: slug.length > 0,
  })
}

export function useGameClipsQuery(
  slug: string,
  params: GameClipsParams = {}
): UseQueryResult<ClipRow[]> {
  return useQuery({
    queryKey: gameKeys.clips(slug, params),
    queryFn: () => fetchGameClips(slug, params),
    enabled: slug.length > 0,
  })
}

export function useGameTopClipsQuery(
  slug: string,
  { limit = 5 }: { limit?: number } = {}
): UseQueryResult<ClipRow[]> {
  return useQuery({
    queryKey: gameKeys.topClips(slug, limit),
    queryFn: () => fetchGameTopClips(slug, limit),
    enabled: slug.length > 0,
  })
}

export function useInvalidateGames() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: gameKeys.all })
}
