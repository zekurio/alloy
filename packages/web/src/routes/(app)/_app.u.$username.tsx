import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { UserXIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { BlockedGate } from "@/components/routes/profile/blocked-gate"
import { ProfileIdentity } from "@/components/routes/profile/profile-identity"
import { ProfileIdentitySkeleton } from "@/components/routes/profile/profile-identity-skeleton"
import { ProfileTabsNav } from "@/components/routes/profile/profile-tabs-nav"
import { userClipsQueryOptions, useUserClipsQuery } from "@/lib/clip-queries"
import {
  useProfileCachePatchers,
  userProfileQueryOptions,
  userProfileViewerQueryOptions,
  useUserProfileQuery,
  useUserProfileViewerQuery,
} from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username")({
  loader: async ({ context, params }) => {
    const profileOptions = userProfileQueryOptions(params.username)
    const clipsOptions = userClipsQueryOptions(params.username)
    const viewerOptions = userProfileViewerQueryOptions(params.username)
    const profile = await context.queryClient.ensureQueryData(profileOptions)
    await context.queryClient.ensureQueryData(viewerOptions)
    void context.queryClient.prefetchQuery(clipsOptions)
    return { profile }
  },
  component: UserProfileLayout,
})

function UserProfileLayout() {
  const { username } = Route.useParams()
  const navigate = useNavigate()
  const profileQuery = useUserProfileQuery(username)
  const viewerQuery = useUserProfileViewerQuery(username)
  // Prime the clips cache from the layout — children read the same query key
  // via `useUserClipsQuery` and will get instant data on route change.
  useUserClipsQuery(username)
  const { setViewer } = useProfileCachePatchers(username)
  const baseProfile = profileQuery.data ?? null
  const viewer = viewerQuery.data?.viewer
  const profile = baseProfile
    ? {
        ...baseProfile,
        counts: viewerQuery.data?.counts ?? baseProfile.counts,
      }
    : null
  const profileError = profileQuery.error ?? null
  const [revealed, setRevealed] = useState(false)

  // Reset the reveal gate on navigation between profiles — the query
  // layer handles data caching and the old per-profile refetch.
  useEffect(() => {
    setRevealed(false)
  }, [username])

  const isBlockedView = !!(viewer && !viewer.isSelf && viewer.isBlocked)
  const gated = isBlockedView && !revealed

  return (
    <AppMain className="!px-0 !pt-0">
      <div
        aria-hidden={gated ? true : undefined}
        className={gated ? "pointer-events-none select-none" : undefined}
      >
        {profileError ? (
          <EmptyState
            icon={UserXIcon}
            size="lg"
            title={t("Couldn't load profile")}
          />
        ) : profile ? (
          <ProfileIdentity
            profile={profile}
            viewer={viewer}
            onViewerChange={setViewer}
          />
        ) : (
          <ProfileIdentitySkeleton />
        )}

        <div className="px-[var(--app-content-padding)]">
          <ProfileTabsNav username={username} counts={profile?.counts} />
          <Outlet />
        </div>
      </div>

      <BlockedGate
        open={gated}
        handle={username}
        onReveal={() => setRevealed(true)}
        onCancel={() => {
          void navigate({ to: "/" })
        }}
      />
    </AppMain>
  )
}
