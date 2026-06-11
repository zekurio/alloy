import { useNavigate, useSearch } from "@tanstack/react-router"
import type { ClipFeedWindow, FeedFilter } from "alloy-api"
import { AppMain } from "alloy-ui/components/app-shell"

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
    <AppMain className="!p-0">
      <div className="flex w-full flex-col px-4 pb-4 md:px-8 md:pb-6">
        {/* Top padding lives here, not on AppMain, so the sticky chip bar can
            pin flush under the header instead of leaving a gap above it. */}
        <div className="pt-4 md:pt-6">
          <TopClipsSection viewerId={viewerId} window={window} />
        </div>
        <FeedChipBar filter={filter} onChange={setFilter} />
        <FeedSection filter={filter} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}
