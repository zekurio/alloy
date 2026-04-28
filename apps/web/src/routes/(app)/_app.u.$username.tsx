import * as React from "react"
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { BlockedGate } from "@/components/routes/profile/blocked-gate"
import { ProfileIdentity } from "@/components/routes/profile/profile-identity"
import { ProfileIdentitySkeleton } from "@/components/routes/profile/profile-identity-skeleton"
import { ProfileTabsNav } from "@/components/routes/profile/profile-tabs-nav"
import { EmptyState } from "@/components/feedback/empty-state"
import { useUserClipsQuery, userClipsQueryOptions } from "@/lib/clip-queries"
import { api } from "@/lib/api"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import {
  useProfileCachePatchers,
  useUserProfileQuery,
  useUserProfileViewerQuery,
  userProfileQueryOptions,
  userProfileViewerQueryOptions,
} from "@/lib/user-queries"

export const Route = createFileRoute("/(app)/_app/u/$username")({
  loader: async ({ context, params }) => {
    const profileOptions = userProfileQueryOptions(params.username)
    const clipsOptions = userClipsQueryOptions(params.username)
    const viewerOptions = userProfileViewerQueryOptions(params.username)
    const profile = await context.queryClient.ensureQueryData(profileOptions)
    await context.queryClient.ensureQueryData({
      ...viewerOptions,
      queryFn: () => api.users.fetchProfileViewer(params.username),
    })
    void context.queryClient.prefetchQuery({
      ...clipsOptions,
      queryFn: () => api.users.fetchClips(params.username),
    })
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
  const clipsQuery = useUserClipsQuery(username)
  const { setViewer, bumpFollowers } = useProfileCachePatchers(username)
  const baseProfile = profileQuery.data ?? null
  const viewer = viewerQuery.data?.viewer
  const profile = baseProfile
    ? {
        ...baseProfile,
        counts: viewerQuery.data?.counts ?? baseProfile.counts,
      }
    : null
  const profileError = profileQuery.error ?? null
  useQueryErrorToast(profileError, {
    title: "Couldn't load profile",
    toastId: `profile-${username}-error`,
  })
  const clipsCount = clipsQuery.data?.length ?? null
  const [revealed, setRevealed] = React.useState(false)

  // Reset the reveal gate on navigation between profiles — the query
  // layer handles data caching and the old per-profile refetch.
  React.useEffect(() => {
    setRevealed(false)
  }, [username])

  const isBlockedView = !!(viewer && !viewer.isSelf && viewer.isBlocked)
  const gated = isBlockedView && !revealed

  return (
    <>
      <AppMain className="!px-0 !py-0">
        <div
          aria-hidden={gated ? true : undefined}
          className={gated ? "pointer-events-none select-none" : undefined}
        >
          {profileError ? (
            <EmptyState
              seed={`profile-error-${username}`}
              size="lg"
              title="Couldn't load profile"
            />
          ) : profile ? (
            <ProfileIdentity
              profile={profile}
              viewer={viewer}
              onViewerChange={setViewer}
              onFollowerDelta={bumpFollowers}
            />
          ) : (
            <ProfileIdentitySkeleton />
          )}

          <div className="px-4 pb-4 md:px-8 md:pb-6">
            <ProfileTabsNav username={username} clipsCount={clipsCount} />
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
    </>
  )
}
