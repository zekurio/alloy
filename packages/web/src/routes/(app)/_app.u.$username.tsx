import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { AppMain } from "alloy-ui/components/app-shell"
import { cn } from "alloy-ui/lib/utils"
import * as React from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { BlockedGate } from "@/components/routes/profile/blocked-gate"
import { ProfileBackground } from "@/components/routes/profile/profile-background"
import { ProfileBanner } from "@/components/routes/profile/profile-banner"
import { ProfileIdentity } from "@/components/routes/profile/profile-identity"
import { ProfileIdentitySkeleton } from "@/components/routes/profile/profile-identity-skeleton"
import { ProfileTabsNav } from "@/components/routes/profile/profile-tabs-nav"
import { userClipsQueryOptions, useUserClipsQuery } from "@/lib/clip-queries"
import { accentCssVars } from "@/lib/color"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
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
  const [revealed, setRevealed] = React.useState(false)

  // Reset the reveal gate on navigation between profiles — the query
  // layer handles data caching and the old per-profile refetch.
  React.useEffect(() => {
    setRevealed(false)
  }, [username])

  const isBlockedView = !!(viewer && !viewer.isSelf && viewer.isBlocked)
  const gated = isBlockedView && !revealed
  const hasBanner = Boolean(profile?.user.banner)
  const hasBackground = Boolean(profile?.user.background)
  // Retint the whole card to the profile's accent (auto-derived from the
  // wallpaper or user-chosen), replacing the default lavender.
  const accentStyle = profile?.user.accentColor
    ? accentCssVars(profile.user.accentColor)
    : undefined

  return (
    <>
      {/* The fallback page surface is a touch lighter than the frosted card so
          the content reads as clearly separate when no wallpaper is set; with a
          wallpaper the darker base sits behind it. */}
      <AppMain
        className={cn(
          "relative grid !px-0 !py-0",
          hasBackground ? "bg-surface-sunken" : "bg-surface",
        )}
      >
        {/* Custom wallpaper sized to the scroll viewport and kept sticky inside
            AppMain, so long mobile profiles cannot scroll past its crop. */}
        {hasBackground ? (
          <div className="pointer-events-none sticky top-0 z-0 h-full min-w-0 [grid-area:1/1]">
            <ProfileBackground src={profile?.user.background} />
          </div>
        ) : null}

        <div
          aria-hidden={gated ? true : undefined}
          className={cn(
            "relative z-10 min-h-full min-w-0 px-3 py-3 [grid-area:1/1] sm:px-6 sm:py-6 lg:px-10",
            gated && "pointer-events-none select-none",
          )}
        >
          <div className="mx-auto mb-8 w-full max-w-[1500px] min-w-0">
            {profileError ? (
              <EmptyState
                seed={`profile-error-${username}`}
                size="lg"
                title="Couldn't load profile"
              />
            ) : (
              // The fully floating profile card: an optional banner plus the
              // frosted content body, rounded and shadowed so it lifts off the
              // wallpaper. With no banner the body itself is the rounded top.
              <div
                style={accentStyle}
                className="ring-border/60 min-w-0 overflow-hidden rounded-2xl shadow-[var(--shadow-lg)] ring-1"
              >
                {hasBanner && profile ? (
                  <ProfileBanner user={profile.user} />
                ) : null}

                {/* Frosted body — translucent + blurred so the wallpaper bleeds
                    through and tints everything inside. */}
                <div className="bg-surface-sunken/55 relative min-w-0 px-4 pb-8 backdrop-blur-2xl backdrop-saturate-150 sm:px-6">
                  {profile ? (
                    <ProfileIdentity
                      profile={profile}
                      viewer={viewer}
                      onViewerChange={setViewer}
                      onFollowerDelta={bumpFollowers}
                      hasBanner={hasBanner}
                    />
                  ) : (
                    <ProfileIdentitySkeleton />
                  )}

                  <ProfileTabsNav username={username} />
                  <Outlet />
                </div>
              </div>
            )}
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
