import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "../components/routes/home/home-page-inner"

/**
 * Home feed.
 *
 * Two shelves:
 *   - **Top clips** — tabbed by window (today / week / month), top 5 by
 *     like count. Small data set, one fetch per tab click. The chips keep
 *     the previous tab's cards visible until the new window resolves so
 *     the row doesn't blank on every click.
 *   - **Recent clips** — infinite scroll, 50 rows per batch, cursor-based.
 *     We watch a sentinel below the grid with `IntersectionObserver`; when
 *     it enters the viewport we page forward until the server stops
 *     returning full batches.
 *
 * Both shelves hold their data in TanStack Query so clip mutations and
 * new uploads (see `clip-queries.ts`) can invalidate the feed without
 * each section needing to own refetch plumbing.
 *
 * The galleries sit inside a centered `max-w` container (`6xl`) with
 * mirrored horizontal padding so the content doesn't stretch across
 * wider viewports and the left/right gutters match.
 */
export const Route = createFileRoute("/_app/")({
  component: HomePage,
})

function HomePage() {
  return (
    <React.Suspense fallback={null}>
      <HomePageInner />
    </React.Suspense>
  )
}
