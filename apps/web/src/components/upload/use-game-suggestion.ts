import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import type { MlGameSuggestionPrediction, PublicMlConfig } from "@workspace/api"

import { api } from "@/lib/api"
import { mlKeys } from "@/lib/ml-queries"

import { captureFrames } from "./new-clip-helpers"

/**
 * Captures frames from the staged file and asks the ML service to guess the
 * game. Returns predictions sorted best-first. Advisory only: any failure
 * resolves to an empty list so the upload flow never blocks on it.
 *
 * Keyed by `fileKey` so swapping the file (Replace) re-runs cleanly, and held
 * with an infinite `staleTime` since frames are deterministic per file.
 */
export function useGameSuggestionQuery(
  file: File,
  fileKey: string,
  config: PublicMlConfig | undefined,
  { enabled }: { enabled: boolean }
): UseQueryResult<MlGameSuggestionPrediction[]> {
  return useQuery({
    queryKey: mlKeys.suggestion(fileKey),
    enabled: enabled && config?.enabled === true,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!config) return []
      const frames = await captureFrames(file, {
        count: config.frameCount,
        maxWidth: config.frameWidth,
      })
      if (frames.length === 0) return []
      const res = await api.ml.suggestGames(frames, config.topK)
      return [...res.predictions].sort((a, b) => b.score - a.score)
    },
  })
}
