import * as React from "react"
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { BlockedGate } from "../components/routes/profile/blocked-gate"
import { ProfileIdentity } from "../components/routes/profile/profile-identity"
import { ProfileIdentitySkeleton } from "../components/routes/profile/profile-identity-skeleton"
import { ProfileTabsNav } from "../components/routes/profile/profile-tabs-nav"
import { EmptyState } from "../components/empty-state"
import { useUserClipsQuery } from "../lib/clip-queries"
import { useQueryErrorToast } from "../lib/use-query-error-toast"
import {
  useProfileCachePatchers,
  useUserProfileQuery,
} from "../lib/user-queries"

/**
 * Public user profile at `/u/$username`.
 *
 * This file is the **layout** for the profile surface. The identity header
 * and the tab nav live here; each tab is its own child route that renders
 * into the `<Outlet/>`:
 *
 *   /u/:username         → redirects to /feed  (`_app.u.$username.index`)
 *   /u/:username/feed    → games carousel + recent clips
 *   /u/:username/all     → full clip grid with sort + game filters
 *                          (search params: `?game=<slug>&sort=<key>`)
 *   /u/:username/tagged  → placeholder
 *
 * Children pull the clips list via `useUserClipsQuery(username)` — React
 * Query dedupes, so every tab share a single fetch without prop-drilling.
 *
 * The `$username` segment accepts either a real username or a raw user id —
 * the server resolves both (`resolveTarget`) so any pre-username bookmarks
 * still land on the right page.
 */
export const Route = createFileRoute("/_app/u/$username")({
  component: UserProfileLayout,
})

function UserProfileLayout() {
  const { username } = Route.useParams()
  const navigate = useNavigate()
  // Profile pages are public — `UserMenu` inside `HomeHeader` suspends on
  // its own Suspense boundary, rendering a chip skeleton until better-auth's
  // session atom resolves. Signed-out visitors see a Sign-in link instead.
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
  // When viewing a user the viewer has blocked, the page paints blurred and
  // a confirm dialog asks whether to reveal. `revealed` overrides the gate
  // for the rest of the visit; resetting on username change ensures the
  // warning re-appears for each new blocked profile.
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
          className={
            gated ? "pointer-events-none blur-md select-none" : undefined
          }
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
              /**
               * Counts are read-only from the header's perspective, but a
               * follow/unfollow action affects the target's follower count.
               * Refetching on every action would flicker, so we patch the
               * profile cache locally and let the next stale refetch
               * reconcile if needed.
               */
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
