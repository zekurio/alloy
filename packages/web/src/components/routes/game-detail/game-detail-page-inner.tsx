import type { ClipFeedWindow } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"

import { useRequireAuth } from "@/lib/auth-hooks"

import { GameHeader } from "./game-header"
import { RecentClipsSection } from "./recent-clips-section"
import { GameTopClipsSection } from "./top-clips-section"

type GameDetailPageInnerProps = {
  slug: string
  window: ClipFeedWindow
}

export function GameDetailPageInner({
  slug,
  window,
}: GameDetailPageInnerProps) {
  const session = useRequireAuth()
  const viewerId = session?.user.id

  return (
    <AppMain className="!px-0 !py-0">
      <div className="flex w-full flex-col gap-6">
        <GameHeader slug={slug} />
        <div className="flex flex-col gap-6 px-4 pb-4 md:px-8 md:pb-6">
          <GameTopClipsSection
            slug={slug}
            viewerId={viewerId}
            window={window}
          />
          <RecentClipsSection slug={slug} viewerId={viewerId} />
        </div>
      </div>
    </AppMain>
  )
}
