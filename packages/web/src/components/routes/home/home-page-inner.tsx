import type { ClipFeedWindow, FeedFilter } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { useNavigate, useSearch } from "@tanstack/react-router"

import { useRequireAuth } from "@/lib/auth-hooks"
import type { HomeSearch } from "@/lib/home-search"

import { FeedChipBar } from "./feed-chip-bar"
import { FeedSection } from "./feed-section"
import { TopClipsSection } from "./top-clips-section"

function filterFromSearch(search: HomeSearch): FeedFilter {
  if (search.game) {
    const steamgriddbId = Number.parseInt(search.game, 10)
    if (Number.isSafeInteger(steamgriddbId) && steamgriddbId > 0) {
      return { kind: "game", steamgriddbId }
    }
  }
  if (search.feed === "following") return { kind: "following" }
  return { kind: "foryou" }
}

export function HomePageInner() {
  const session = useRequireAuth()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as HomeSearch

  const filter = filterFromSearch(search)
  const window: ClipFeedWindow = search.window ?? "today"

  // The feed filter lives in the URL so it is shareable and survives reloads,
  // mirroring the top-clips window and the profile sort. `window`/other params
  // are preserved by spreading the previous search.
  function setFilter(next: FeedFilter) {
    void navigate({
      to: "/",
      search: (prev: HomeSearch) => ({
        ...prev,
        game: next.kind === "game" ? String(next.steamgriddbId) : undefined,
        feed: next.kind === "following" ? ("following" as const) : undefined,
      }),
    })
  }

  const viewerId = session?.user.id

  return (
    <AppMain>
      <div className="flex w-full flex-col">
        <TopClipsSection viewerId={viewerId} window={window} />
        {/* The chip bar bleeds past AppMain's padding (-mx-8) and pins flush
            under the header: a sticky top-0 child sticks to the scrollport's
            padding-box top, so AppMain's py-6 leaves no gap above it. */}
        <FeedChipBar filter={filter} onChange={setFilter} />
        <FeedSection filter={filter} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}
