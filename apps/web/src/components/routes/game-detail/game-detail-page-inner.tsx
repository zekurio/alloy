import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "../../../lib/auth-hooks"
import { GameHeader } from "./game-header"
import { RecentClipsSection } from "./recent-clips-section"
import { TopClipsSection } from "./top-clips-section"

type GameDetailPageInnerProps = {
  slug: string
}

export function GameDetailPageInner({ slug }: GameDetailPageInnerProps) {
  const session = useRequireAuth()
  const viewerId = session?.user.id

  return (
    <AppMain>
      <div className="flex w-full flex-col gap-8">
        <GameHeader slug={slug} />
        <TopClipsSection slug={slug} viewerId={viewerId} />
        <RecentClipsSection slug={slug} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}
