import { useNavigate, useSearch } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "@/lib/auth-hooks"
import type { HomeSearch } from "@/lib/home-search"
import type { ClipFeedWindow, FeedFilter } from "@workspace/api"
import { FeedChipBar } from "./feed-chip-bar"
import { FeedSection } from "./feed-section"
import { TopClipsSection } from "./top-clips-section"

function filterFromSearch(search: HomeSearch): FeedFilter {
  if (search.tag) return { kind: "hashtag", tag: search.tag }
  if (search.game) return { kind: "game", gameId: search.game }
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
        tag: next.kind === "hashtag" ? next.tag : undefined,
        game: next.kind === "game" ? next.gameId : undefined,
        feed: next.kind === "following" ? ("following" as const) : undefined,
      }),
    })
  }

  const viewerId = session?.user.id

  return (
    <AppMain>
      <div className="flex w-full flex-col">
        <TopClipsSection
          viewerId={viewerId}
          window={window}
          hashtag={search.tag}
        />
        <FeedChipBar filter={filter} onChange={setFilter} />
        <FeedSection filter={filter} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}
