import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { api } from "@/lib/api"

export const adminKeys = {
  all: ["admin"] as const,
  runtimeConfig: () => [...adminKeys.all, "runtime-config"] as const,
  transcodingCapabilities: () =>
    [...adminKeys.all, "transcoding-capabilities"] as const,
  users: (search?: string) =>
    search
      ? ([...adminKeys.all, "users", search] as const)
      : ([...adminKeys.all, "users"] as const),
  games: () => [...adminKeys.all, "games"] as const,
  webhooks: () => [...adminKeys.all, "webhooks"] as const,
}

export function adminRuntimeConfigQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.runtimeConfig(),
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })
}

export function adminTranscodingCapabilitiesQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.transcodingCapabilities(),
    queryFn: () => api.admin.fetchTranscodingCapabilities(),
    // Probing spawns several ffmpeg test encodes, so this is expensive; keep it
    // fresh for the session and re-probe only when the admin hits "Re-detect".
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function adminUsersQueryOptions(search = "") {
  return infiniteQueryOptions({
    queryKey: adminKeys.users(search),
    queryFn: ({ pageParam }) =>
      api.admin.fetchUsers(
        pageParam ? { cursor: pageParam, search } : { search },
      ),
    // SAFETY: The API cursor domain is string or null; null is its first page.
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

export function adminGamesQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.games(),
    queryFn: () => api.admin.fetchGames(),
  })
}

export function adminWebhooksQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.webhooks(),
    queryFn: () => api.admin.fetchWebhooks(),
  })
}
