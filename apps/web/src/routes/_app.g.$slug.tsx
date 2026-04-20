import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { GameDetailPageInner } from "../components/routes/game-detail/game-detail-page-inner"

/**
 * `/g/$slug` — single game detail page. Three sections:
 *
 *   1. **Hero banner** — SGDB hero art (bled full-width inside `AppMain`'s
 *      container) with the logo/title, release date, and clip count
 *      floating above a gradient scrim at the bottom.
 *   2. **Top clips** — the server's weighted "best of this game" list,
 *      rendered the same way as the home feed's top strip so the cards
 *      feel familiar.
 *   3. **Recent clips** — straight chronological, capped at the server
 *      limit. No infinite scroll yet — most games have < 100 clips and
 *      the grid scrolls fast. If that changes we'll lift the same
 *      observer plumbing from `_app.index.tsx`.
 *
 * The page intentionally keeps its data behind three independent queries
 * (detail / top / recent) so paging or filtering the clip grid doesn't
 * force the banner to re-render with a spinner.
 */
export const Route = createFileRoute("/_app/g/$slug")({
  component: GameDetailPage,
})

function GameDetailPage() {
  const { slug } = Route.useParams()

  return (
    <React.Suspense fallback={null}>
      <GameDetailPageInner slug={slug} />
    </React.Suspense>
  )
}
