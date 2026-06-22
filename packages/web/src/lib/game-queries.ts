import type {
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@alloy/api"
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { api } from "./api"
import { feedKeys } from "./feed-queries"

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
  detail: (gameId: string, viewerId: string | null) =>
    [
      ...gameKeys.detailScope(gameId),
      { viewerId: viewerId ?? "anonymous" },
    ] as const,
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

export function useGamesListQuery(): UseQueryResult<GameListRow[]> {
  return useQuery({
    queryKey: gameKeys.list(),
    queryFn: () => api.games.fetchAll(),
    // Clip uploads nudge this indirectly (new game → new row). 60s is a
    // decent balance between freshness and not hammering on tab flips.
    staleTime: 60_000,
  })
}

export function invalidateGameQueries(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: gameKeys.all })
}

export function useInvalidateGames(): () => void {
  const qc = useQueryClient()
  return useCallback(() => {
    void invalidateGameQueries(qc)
  }, [qc])
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

export function useGameQuery(
  gameId: string,
  viewerId: string | null,
): UseQueryResult<GameDetail> {
  return useQuery({
    queryKey: gameKeys.detail(gameId, viewerId),
    queryFn: () => api.games.fetchById(gameId),
    enabled: gameId.length > 0,
  })
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

export function useToggleGameFavoriteMutation() {
  const qc = useQueryClient()

  return useMutation<
    { following: boolean },
    Error,
    { gameId: string; next: boolean; viewerId: string | null },
    {
      detailKey: ReturnType<typeof gameKeys.detail>
      previous: GameDetail | undefined
    }
  >({
    mutationFn: ({ gameId, next }) =>
      next ? api.games.follow(gameId) : api.games.unfollow(gameId),
    onMutate: async ({ gameId, next, viewerId }) => {
      const detailKey = gameKeys.detail(gameId, viewerId)
      await qc.cancelQueries({ queryKey: detailKey })
      const previous = qc.getQueryData<GameDetail>(detailKey)
      qc.setQueryData<GameDetail>(detailKey, (old) => {
        if (!old) return old
        const wasFollowing = old.viewer?.isFollowing ?? false
        const delta = next === wasFollowing ? 0 : next ? 1 : -1
        return {
          ...old,
          viewer: { isFollowing: next },
          favouritesCount: Math.max(0, old.favouritesCount + delta),
        }
      })
      return { detailKey, previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(context.detailKey, context.previous)
      }
    },
    onSettled: (_data, _error, variables) => {
      void qc.invalidateQueries({
        queryKey: gameKeys.detailScope(variables.gameId),
      })
      void qc.invalidateQueries({ queryKey: feedKeys.all })
    },
  })
}
