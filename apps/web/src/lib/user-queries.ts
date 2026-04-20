import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchUserProfile,
  type ProfileViewer,
  type UserProfile,
} from "./users-api"

/**
 * User-profile queries and cache helpers.
 *
 * Scope is intentionally narrow for this pass — it covers the `/u/:handle`
 * page header (profile + counts + viewer state). Follow/unfollow/block
 * mutations still route through `profile-actions.tsx` with optimistic
 * local updates; this module just exposes the cache surface so those
 * callbacks can write through to TanStack Query instead of component
 * state.
 */

export const userKeys = {
  all: ["user"] as const,
  profile: (handle: string) => [...userKeys.all, "profile", handle] as const,
}

export function useUserProfileQuery(handle: string) {
  return useQuery({
    queryKey: userKeys.profile(handle),
    queryFn: () => fetchUserProfile(handle),
    enabled: handle.length > 0,
  })
}

/**
 * Returns helpers for the profile-header view to apply optimistic viewer
 * and follower-count updates directly to the cache. Pull into the page
 * instead of prop-drilling `setProfile` callbacks so the profile-actions
 * component can stay unaware of the query layer.
 */
export function useProfileCachePatchers(handle: string) {
  const qc = useQueryClient()
  const key = userKeys.profile(handle)

  return {
    setViewer: (viewer: ProfileViewer) => {
      qc.setQueryData<UserProfile>(key, (old) =>
        old ? { ...old, viewer } : old
      )
    },
    bumpFollowers: (delta: number) => {
      qc.setQueryData<UserProfile>(key, (old) =>
        old
          ? {
              ...old,
              counts: {
                ...old.counts,
                followers: Math.max(0, old.counts.followers + delta),
              },
            }
          : old
      )
    },
  }
}
