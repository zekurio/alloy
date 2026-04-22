import { createFileRoute } from "@tanstack/react-router"

import { DangerZoneCard } from "@/components/routes/settings/danger-zone-card"
import { LinkedAccountsCard } from "@/components/routes/settings/linked-accounts-card"
import { PasskeysCard } from "@/components/routes/settings/passkeys-card"
import { ProfileCard } from "@/components/routes/settings/profile-card"
import { useRequireAuthStrict } from "@/lib/auth-hooks"

export const Route = createFileRoute("/(app)/_app/_settings/user-settings")({
  component: ProfilePage,
})

function ProfilePage() {
  const session = useRequireAuthStrict()
  const user = session?.user
  if (!session || !user) return null

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">
        Profile settings
      </h1>
      <ProfileCard
        key={user.id}
        userId={user.id}
        initialName={user.name ?? ""}
        initialUsername={user.username ?? ""}
        image={user.image ?? ""}
        email={user.email ?? ""}
      />
      <LinkedAccountsCard />
      <PasskeysCard />
      <DangerZoneCard />
    </>
  )
}
