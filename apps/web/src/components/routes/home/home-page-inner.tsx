import * as React from "react"

import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "@/lib/auth-hooks"
import type { FeedFilter } from "@workspace/api"
import { FeedChipBar } from "./feed-chip-bar"
import { FeedSection } from "./feed-section"
import { TopClipsSection } from "./top-clips-section"

export function HomePageInner() {
  const session = useRequireAuth()
  const [filter, setFilter] = React.useState<FeedFilter>({ kind: "foryou" })

  const viewerId = session?.user.id

  return (
    <AppMain>
      <div className="flex w-full flex-col">
        <TopClipsSection viewerId={viewerId} />
        <FeedChipBar filter={filter} onChange={setFilter} />
        <div className="pt-8">
          <FeedSection filter={filter} viewerId={viewerId} />
        </div>
      </div>
    </AppMain>
  )
}
