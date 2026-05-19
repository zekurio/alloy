import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "@/lib/auth-hooks"
import type { FeedFilter } from "@workspace/api"
import { FeedChipBar } from "./feed-chip-bar"
import { FeedSection } from "./feed-section"
import { TopClipsSection } from "./top-clips-section"

export function HomePageInner() {
  const session = useRequireAuth()
  const navigate = useNavigate()
  const { tag } = useSearch({ strict: false }) as { tag?: string }
  const [localFilter, setLocalFilter] = React.useState<FeedFilter>({
    kind: "foryou",
  })

  const filter: FeedFilter = tag ? { kind: "hashtag", tag } : localFilter

  function setFilter(next: FeedFilter) {
    setLocalFilter(next)
    if (tag) {
      void navigate({
        to: "/",
        search: (prev) => ({ ...prev, tag: undefined }),
      })
    }
  }

  const viewerId = session?.user.id

  return (
    <AppMain>
      <div className="flex w-full flex-col">
        <TopClipsSection viewerId={viewerId} hashtag={tag} />
        <FeedChipBar filter={filter} onChange={setFilter} />
        <FeedSection filter={filter} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}
