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

/**
 * Centralised query keys + hooks for the games surface. Mirrors the
 * shape of `clip-queries.ts` — one `games` root so a blanket invalidate
 * covers every cache entry, sub-branches keyed on the parameter that
 * actually varies (query string, slug, sort).
 *
 * The SGDB integration adds a couple of quirks to note:
 *   - `/status` is cached ~5 minutes because the answer only changes
 *     when an admin flips the key in settings; polling it for every
 *     upload-modal mount would be wasteful.
 *   - `/search` keys on the *trimmed* query. The caller is expected to
 *     debounce before the key lands here — otherwise every keystroke
 *     mints a new cache entry.
 */

// ─── Query keys ─────────────────────────────────────────────────────────

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
  /**
   * Paginated clip grid under a game. Keyed on slug + a serialised copy
   * of the query params so a switch between "top" and "recent" is a
   * different cache entry rather than a mutation.
   */
  clips: (slug: string, params: GameClipsParams) =>
    [...gameKeys.all, "clips", slug, params] as const,
  /** Weighted top strip on the game detail page. */
  topClips: (slug: string, limit: number) =>
    [...gameKeys.all, "topClips", slug, { limit }] as const,
}

// ─── Status ─────────────────────────────────────────────────────────────

/**
 * `steamgriddbConfigured` boolean. Cached aggressively — the answer only
 * flips when an admin saves a new key in settings, and the upload modal
 * mounts frequently enough that a fresh network call per open would be
 * wasteful. Invalidated from the admin settings save path.
 */
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

// ─── Search ─────────────────────────────────────────────────────────────

/**
 * Autocomplete results for a game picker. Caller is responsible for
 * debouncing the input before passing it here — the hook doesn't know
 * whether the text came from a keystroke or an already-settled query,
 * and re-keying on every letter would mint throwaway cache entries.
 *
 * Short `staleTime` so two pickers on the same page don't double-fetch
 * but typing through the same text later still sees a fresh result.
 */
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

/**
 * Upsert a SGDB id into our `game` table. Returns the full row so
 * callers (the upload modal, the inline editor) can preview the hero
 * or pipe the id into `gameId` on initiate/update without a second GET.
 * Idempotent — repeat picks of the same game reuse the existing row.
 */
export function useResolveGameMutation() {
  return useMutation<GameRow, Error, { steamgriddbId: number }>({
    mutationFn: ({ steamgriddbId }) => resolveGame(steamgriddbId),
  })
}

// ─── Game listing + detail ─────────────────────────────────────────────

/**
 * Landscape grid for `/games`. Sorted by clip count on the server; the
 * rows carry the hero/logo we cached at resolve time, so the grid
 * paints without an SGDB round trip. Refetching is cheap — one row per
 * distinct game in the instance, not per clip.
 */
export function useGamesListQuery(): UseQueryResult<GameListRow[]> {
  return useQuery({
    queryKey: gameKeys.list(),
    queryFn: fetchGames,
    // Clip uploads nudge this indirectly (new game → new row). 60s is a
    // decent balance between freshness and not hammering on tab flips.
    staleTime: 60_000,
  })
}

/**
 * Single game detail for the `/g/:slug` banner. Separate from the clip
 * list beneath because paging through clips shouldn't force a refetch
 * of the hero/logo URLs.
 */
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

// ─── Cross-module invalidation hooks ────────────────────────────────────

/**
 * Nudge every games cache to refetch. Called from paths that *upsert* a
 * game row (e.g. resolving a new SGDB id while uploading) so the `/games`
 * grid reflects the newcomer on its next render without a page reload.
 */
export function useInvalidateGames() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: gameKeys.all })
}
