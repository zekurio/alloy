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

  if (!session) return null

  return (
    <AppMain>
      <div className="flex w-full flex-col gap-8">
        <GameHeader slug={slug} />
        <TopClipsSection slug={slug} viewerId={session.user.id} />
        <RecentClipsSection slug={slug} viewerId={session.user.id} />
      </div>
    </AppMain>
  )
}
