import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query"

/** The query cache key of a `useDesktopQuery` read. */
export function desktopQueryKey(key: readonly string[]): readonly string[] {
  return ["desktop", ...key]
}

/**
 * Loads a value from a native bridge call through TanStack Query. The host
 * pushes nothing for these reads, so they load when the first reader mounts,
 * never refetch on focus or retry, and are dropped once the last reader
 * unmounts; `refetch` re-reads on demand. `setData` applies the result of a
 * follow-up call without a refetch.
 *
 * Pass `load: null` when the bridge is unavailable (plain web) or the value
 * isn't needed yet: the query stays idle with `data` undefined. When
 * `reloadWhenEnabled` returns true for the loaded value, the next switch from
 * null back to a loader re-reads, e.g. whenever a picker opens. A rejected
 * loader leaves `data` as it was and sets `error` until the next load
 * succeeds.
 */
export function useDesktopQuery<T>(
  key: readonly string[],
  load: (() => Promise<T>) | null | undefined,
  {
    reloadWhenEnabled,
  }: { reloadWhenEnabled?: (data: T | undefined) => boolean } = {},
) {
  const queryClient = useQueryClient()
  const queryKey = desktopQueryKey(key)
  const query = useQuery({
    queryKey,
    queryFn: load ?? skipToken,
    staleTime: (current) =>
      reloadWhenEnabled?.(current.state.data) ? 0 : Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Bridge calls never touch the network.
    networkMode: "always",
  })

  return {
    data: query.data,
    setData: (next: T | ((current: T | undefined) => T | undefined)) =>
      queryClient.setQueryData<T>(queryKey, next),
    loading: query.isFetching,
    /** Whether a load has settled, even if a reload is now in flight. */
    loaded: query.dataUpdatedAt > 0 || query.errorUpdatedAt > 0,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}
