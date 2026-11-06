import { HttpError } from "@alloy/api"
import { UNCATEGORISED_GAME_SLUG } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import type { QueryClient } from "@tanstack/react-query"
import { redirect, useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import type { AppSearch } from "./app-search"
import { clipDetailQueryOptions } from "./clip-queries"

/** Every clip lives under its game, or under the uncategorised group. */
export function clipPermalink(clipId: string, gameId: string | null) {
  return {
    to: "/games/$gameId/clips/$clipId",
    params: { gameId: gameId ?? UNCATEGORISED_GAME_SLUG, clipId },
  } as const
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
 * Loader for the clip permalink route. A clip the viewer can't see, or one
 * that no longer exists, redirects to the game page instead of rendering an
 * error, with a toast saying why. Hover preloads run this loader too, so they
 * redirect silently; a redirect outcome isn't cached, so the real navigation
 * runs it again and shows the toast.
 */
export async function ensureClipForPermalink(
  queryClient: QueryClient,
  clipId: string,
  gameId: string,
  preload: boolean,
): Promise<void> {
  try {
    await queryClient.ensureQueryData(clipDetailQueryOptions(clipId))
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      if (!preload) {
        // The fixed id keeps a repeated load from stacking duplicate toasts.
        toast.error(t("This clip is no longer available."), {
          id: "clip-unavailable",
        })
      }
      throw redirect({
        to: "/games/$gameId",
        params: { gameId },
        replace: true,
      })
    }
    throw error
  }
}
