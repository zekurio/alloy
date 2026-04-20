import { createFileRoute } from "@tanstack/react-router"

import { DangerZoneCard } from "../components/routes/settings/danger-zone-card"
import { ProfileCard } from "../components/routes/settings/profile-card"
import { useRequireAuth } from "../lib/auth-hooks"

/**
 * Self-service profile page. Users who were bootstrapped via the
 * credential sign-up (the first admin, typically) don't get their `image`
 * or `name` refreshed when they later link an OAuth identity, so this
 * gives them a place to set those by hand. Also exposes account deletion.
 *
 * Chrome (AppShell, sidebar, slim header, back-link, page wrapper) is
 * provided by `_app` + `_app/_settings`. Auth guard fires there too — this
 * leaf can read the session knowing it's already settled.
 */
export const Route = createFileRoute("/_app/_settings/user-settings")({
  component: ProfilePage,
})

function ProfilePage() {
  const session = useRequireAuth()
  if (!session) return null

  const user = session.user

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Profile</h1>
      <ProfileCard
        key={user.id}
        userId={user.id}
        initialName={user.name ?? ""}
        image={user.image ?? ""}
        email={user.email ?? ""}
      />
      <DangerZoneCard />
    </>
  )
}
