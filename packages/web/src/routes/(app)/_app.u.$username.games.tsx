import { createFileRoute } from "@tanstack/react-router"

import { ProfileGamesSection } from "@/components/routes/profile/profile-games-section"

export const Route = createFileRoute("/(app)/_app/u/$username/games")({
  component: ProfileGamesTab,
})

function ProfileGamesTab() {
  const { username } = Route.useParams()
  return <ProfileGamesSection username={username} />
}
