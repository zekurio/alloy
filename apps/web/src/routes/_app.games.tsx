import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { GamesPageInner } from "../components/routes/games/games-page-inner"

/**
 * /games — every game with at least one visible clip, sorted by clip
 * count. Renders as a grid of landscape cards so the SGDB hero art
 * (what `/api/games/resolve` cached on the row) reads as the card's
 * primary surface. Tapping any card drops into `/g/:slug`.
 *
 * Legacy text-only clips (no mapped SGDB row) don't show up here — the
 * server only lists `game` table rows, and those only exist for clips
 * that were uploaded or re-tagged after the SGDB integration landed.
 * Backfilling those will be a one-off migration; surfacing them with a
 * placeholder tile would just muddy the "browse by game" experience.
 */
export const Route = createFileRoute("/_app/games")({
  component: GamesPage,
})

function GamesPage() {
  return (
    <React.Suspense fallback={null}>
      <GamesPageInner />
    </React.Suspense>
  )
}
