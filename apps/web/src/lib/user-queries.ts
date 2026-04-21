import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchTaggedClips,
  fetchUserFollowers,
  fetchUserFollowing,
  fetchUserProfile,
  searchUsers,
  type ProfileViewer,
  type UserProfile,
} from "./users-api"

export const userKeys = {
  all: ["user"] as const,
  profile: (handle: string) => [...userKeys.all, "profile", handle] as const,
  search: (q: string) => [...userKeys.all, "search", q] as const,
  tagged: (handle: string) => [...userKeys.all, "tagged", handle] as const,
  followers: (handle: string) =>
    [...userKeys.all, "followers", handle] as const,
  following: (handle: string) =>
    [...userKeys.all, "following", handle] as const,
}

export function useUserSearchQuery(q: string) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: userKeys.search(trimmed),
    queryFn: () => searchUsers(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
  })
}

export function useTaggedClipsQuery(handle: string) {
  return useQuery({
    queryKey: userKeys.tagged(handle),
    queryFn: () => fetchTaggedClips(handle),
    enabled: handle.length > 0,
  })
}

export function useUserFollowersQuery(
  handle: string,
  { enabled }: { enabled: boolean }
) {
  return useQuery({
    queryKey: userKeys.followers(handle),
    queryFn: () => fetchUserFollowers(handle),
    enabled: enabled && handle.length > 0,
    staleTime: 30_000,
  })
}

export function useUserFollowingQuery(
  handle: string,
  { enabled }: { enabled: boolean }
) {
  return useQuery({
    queryKey: userKeys.following(handle),
    queryFn: () => fetchUserFollowing(handle),
    enabled: enabled && handle.length > 0,
    staleTime: 30_000,
  })
}

export function useUserProfileQuery(handle: string) {
  return useQuery({
    queryKey: userKeys.profile(handle),
    queryFn: () => fetchUserProfile(handle),
    enabled: handle.length > 0,
  })
}

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
