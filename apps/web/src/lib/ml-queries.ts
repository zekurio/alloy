import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import type { PublicMlConfig } from "@workspace/api"

import { api } from "./api"

export const mlKeys = {
  all: ["ml"] as const,
  /** Per-instance ML feature flags + frame budget for the upload picker. */
  config: () => [...mlKeys.all, "config"] as const,
  /** Frame-derived game guesses, branched per staged file. */
  suggestion: (fileKey: string) =>
    [...mlKeys.all, "game-suggestion", fileKey] as const,
}

export function useMlConfigQuery(): UseQueryResult<PublicMlConfig> {
  return useQuery({
    queryKey: mlKeys.config(),
    queryFn: () => api.ml.getConfig(),
    // Config rarely changes mid-session; a stale-while-revalidate window keeps
    // the upload modal from re-probing on every open.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
