import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "../../../lib/auth-hooks"
import { RecentClipsSection } from "./recent-clips-section"
import { TopClipsSection } from "./top-clips-section"

export function HomePageInner() {
  const session = useRequireAuth()
  if (!session) return null

  return (
    <AppMain>
      <div className="flex w-full flex-col gap-10">
        <TopClipsSection viewerId={session.user.id} />
        <RecentClipsSection viewerId={session.user.id} />
      </div>
    </AppMain>
  )
}
