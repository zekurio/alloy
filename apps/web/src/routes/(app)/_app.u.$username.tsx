import * as React from "react"
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"
import { createMiddleware, createServerFn } from "@tanstack/react-start"

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
  userProfileQueryOptions,
} from "@/lib/user-queries"

const requestContextMiddleware = createMiddleware().server(
  ({ next, request }) => {
    return next({ context: { request } })
  }
)

function cookieInit(request: Request): RequestInit | undefined {
  const cookie = request.headers.get("cookie")
  return cookie ? { headers: { cookie } } : undefined
}

const fetchRouteUserProfile = createServerFn({ method: "GET" })
  .middleware([requestContextMiddleware])
  .inputValidator((handle: string) => handle)
  .handler(async ({ data: handle, context }) => {
    return api.users.fetchProfile(handle, cookieInit(context.request))
  })

const fetchRouteUserClips = createServerFn({ method: "GET" })
  .middleware([requestContextMiddleware])
  .inputValidator((handle: string) => handle)
  .handler(async ({ data: handle, context }) => {
    return api.users.fetchClips(handle, cookieInit(context.request))
  })

export const Route = createFileRoute("/(app)/_app/u/$username")({
  loader: async ({ context, params }) => {
    const profileOptions = userProfileQueryOptions(params.username)
    const clipsOptions = userClipsQueryOptions(params.username)
    const profilePromise = context.queryClient.ensureQueryData({
      ...profileOptions,
      queryFn: () => fetchRouteUserProfile({ data: params.username }),
    })
    void context.queryClient.prefetchQuery({
      ...clipsOptions,
      queryFn: () => fetchRouteUserClips({ data: params.username }),
    })
    return { profile: await profilePromise }
  },
  component: UserProfileLayout,
})

function UserProfileLayout() {
  const { username } = Route.useParams()
  const navigate = useNavigate()
  const profileQuery = useUserProfileQuery(username)
  // Prime the clips cache from the layout — children read the same query key
  // via `useUserClipsQuery` and will get instant data on route change.
  const clipsQuery = useUserClipsQuery(username)
  const { setViewer, bumpFollowers } = useProfileCachePatchers(username)
  const profile = profileQuery.data ?? null
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

  const isBlockedView = !!(
    profile?.viewer &&
    !profile.viewer.isSelf &&
    profile.viewer.isBlocked
  )
  const gated = isBlockedView && !revealed

  return (
    <>
      <AppMain>
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
              onViewerChange={setViewer}
              onFollowerDelta={bumpFollowers}
            />
          ) : (
            <ProfileIdentitySkeleton />
          )}

          <ProfileTabsNav username={username} clipsCount={clipsCount} />
          <Outlet />
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
