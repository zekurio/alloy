import type {
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@alloy/api"
import type { MediaFilter } from "@alloy/contracts"
import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"

import { api } from "./api"

export const gameKeys = {
  all: ["games"] as const,
  /** Boolean `steamgriddbConfigured` — mount check for game search controls. */
  status: () => [...gameKeys.all, "status"] as const,
  /** steamgriddb autocomplete proxy — branches per normalised query string. */
  search: (query: string) => [...gameKeys.all, "search", query] as const,
  /** `/games` landscape grid. One global cache entry. */
  list: () => [...gameKeys.all, "list"] as const,
  lookupByName: (names: readonly string[]) =>
    [...gameKeys.all, "lookup-by-name", names] as const,
  /** Per-game detail for the banner header on `/games/:gameId`. */
  detailScope: (gameId: string) => [...gameKeys.all, "detail", gameId] as const,
  detail: (gameId: string) => gameKeys.detailScope(gameId),
  /** Top creators chip rail on `/games/:gameId`. */
  creators: (gameId: string) =>
    [...gameKeys.detailScope(gameId), "creators"] as const,
}

export function useSteamGridDBStatusQuery(): UseQueryResult<SteamGridDBStatus> {
  return useQuery({
    queryKey: gameKeys.status(),
    queryFn: () => api.games.fetchSteamGridDBStatus(),
    // Config can be changed by another browser session. Keep this cheap probe
    // fresh when the game picker mounts instead of requiring a page reload.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

export function useSearchGamesQuery(
  query: string,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<SteamGridDBSearchResult[]> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: gameKeys.search(trimmed),
    queryFn: () => api.games.search(trimmed),
    // Empty query short-circuits to [] server-side but we still gate the
    // hook to avoid the round trip entirely.
    enabled: enabled && trimmed.length > 0,
    staleTime: 30_000,
    // steamgriddb is the upstream — no point re-hitting on window focus.
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    // Autocomplete doesn't want to thrash on transient network blips —
    // a single retry is enough, the user will type again if it's still bad.
    retry: 1,
  })
}

export function useLocalGameSearchQuery(
  query: string,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<GameRow[]> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: [...gameKeys.all, "local-search", trimmed] as const,
    queryFn: () => api.games.localSearch(trimmed),
    enabled: enabled && trimmed.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

export function useResolveGameMutation() {
  return useMutation<GameRow, Error, { steamgriddbId: number }>({
    mutationFn: ({ steamgriddbId }) => api.games.resolve(steamgriddbId),
  })
}

export function gamesListQueryOptions() {
  return queryOptions({
    queryKey: gameKeys.list(),
    queryFn: () => api.games.fetchAll({ media: "all" }),
    // Clip uploads nudge this indirectly (new game → new row). 60s is a
    // decent balance between freshness and not hammering on tab flips.
    staleTime: 60_000,
  })
}

export function useGamesListQuery(): UseQueryResult<GameListRow[]> {
  return useQuery(gamesListQueryOptions())
}

export function invalidateGameQueries(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: gameKeys.all })
}

export function useGameNameLookupQuery(
  names: readonly string[],
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<GameNameLookupResponse> {
  const lookupNames = normaliseLookupNames(names)
  return useQuery({
    queryKey: gameKeys.lookupByName(lookupNames),
    queryFn: () => api.games.lookupByNames([...lookupNames]),
    enabled: enabled && lookupNames.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useGameQuery(gameId: string): UseQueryResult<GameDetail> {
  return useQuery(gameQueryOptions(gameId))
}

export function gameQueryOptions(gameId: string) {
  return queryOptions({
    queryKey: gameKeys.detail(gameId),
    queryFn: () => api.games.fetchById(gameId, "all"),
    enabled: gameId.length > 0,
  })
}

function gameCreatorsQueryOptions(gameId: string, media: MediaFilter = "all") {
  return queryOptions({
    queryKey: [...gameKeys.creators(gameId), media],
    queryFn: () => api.games.fetchCreators(gameId, undefined, media),
    enabled: gameId.length > 0,
  })
}

export function useGameCreatorsQuery(
  gameId: string,
  media: MediaFilter = "all",
) {
  return useQuery(gameCreatorsQueryOptions(gameId, media))
}

function normaliseLookupNames(names: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result.sort((a, b) => a.localeCompare(b))
}
