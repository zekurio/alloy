import type { AdminJobsSummary } from "@alloy/api"
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { api } from "@/lib/api"

// Ephemeral admin panels poll instead of subscribing to an SSE channel: the
// settings dialog is short-lived and admin-only, so a refetch while mounted is
// cheaper than fanning job events out to every admin. Poll fast while jobs are
// moving, then back off hard once the queues go idle so an open panel isn't
// hitting the server every few seconds when nothing can change.
const JOBS_ACTIVE_REFETCH_INTERVAL_MS = 3000
const JOBS_IDLE_REFETCH_INTERVAL_MS = 30000

export function hasActiveJobs(summary: AdminJobsSummary | undefined): boolean {
  return (
    summary?.kinds.some((kind) => kind.pending > 0 || kind.running > 0) ?? false
  )
}

export const adminKeys = {
  all: ["admin"] as const,
  runtimeConfig: () => [...adminKeys.all, "runtime-config"] as const,
  transcodingCapabilities: () =>
    [...adminKeys.all, "transcoding-capabilities"] as const,
  users: () => [...adminKeys.all, "users"] as const,
  games: () => [...adminKeys.all, "games"] as const,
  jobsSummary: () => [...adminKeys.all, "jobs", "summary"] as const,
  jobsFailed: (kind: string | null) =>
    [...adminKeys.all, "jobs", "failed", kind ?? "all"] as const,
}

export function adminJobsSummaryQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.jobsSummary(),
    queryFn: () => api.admin.fetchJobsSummary(),
    refetchInterval: (query) =>
      hasActiveJobs(query.state.data)
        ? JOBS_ACTIVE_REFETCH_INTERVAL_MS
        : JOBS_IDLE_REFETCH_INTERVAL_MS,
  })
}

// Failed jobs only grow while other jobs are running, so the caller passes the
// current activity so this list slows down alongside the summary when idle.
export function adminFailedJobsQueryOptions(
  kind: string | null,
  jobsActive = false,
) {
  return infiniteQueryOptions({
    queryKey: adminKeys.jobsFailed(kind),
    queryFn: ({ pageParam }) =>
      api.admin.fetchFailedJobs({
        ...(kind ? { kind } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: jobsActive
      ? JOBS_ACTIVE_REFETCH_INTERVAL_MS
      : JOBS_IDLE_REFETCH_INTERVAL_MS,
  })
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

export function adminUsersQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.users(),
    queryFn: () => api.admin.fetchUsers(),
  })
}

export function adminGamesQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.games(),
    queryFn: () => api.admin.fetchGames(),
  })
}
