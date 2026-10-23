import { HttpError } from "@alloy/api"
import type { QueryClient } from "@tanstack/react-query"
import { redirect, useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import type { AppSearch } from "./app-search"
import { clipDetailQueryOptions } from "./clip-queries"

/** Game-scoped when the clip has a game, otherwise `/clips/:clipId`. */
export function clipPermalink(clipId: string, gameId: string | null) {
  return gameId
    ? ({
        to: "/games/$gameId/clips/$clipId",
        params: { gameId, clipId },
      } as const)
    : ({ to: "/clips/$clipId", params: { clipId } } as const)
}

/**
 * Opens the clip viewer over the current page. The address bar shows the
 * clip's permalink while the page underneath stays mounted.
 */
export function useOpenClipDialog() {
  const navigate = useNavigate()
  return useCallback(
    (clipId: string, gameId: string | null, { replace = false } = {}) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, clip: clipId }),
        mask: clipPermalink(clipId, gameId),
        replace,
      })
    },
    [navigate],
  )
}

/**
 * Loader for the clip permalink routes. A clip the viewer can't see, or one
 * that no longer exists, redirects to the game page or home instead of
 * rendering an error.
 */
export async function ensureClipForPermalink(
  queryClient: QueryClient,
  clipId: string,
  gameId: string | null,
): Promise<void> {
  try {
    await queryClient.ensureQueryData(clipDetailQueryOptions(clipId))
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      throw gameId
        ? redirect({
            to: "/games/$gameId",
            params: { gameId },
            replace: true,
          })
        : redirect({ to: "/", replace: true })
    }
    throw error
  }
}
