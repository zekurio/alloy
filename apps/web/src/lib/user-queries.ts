import {
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  ProfileViewer,
  UserProfile,
  UserProfileViewer,
} from "@workspace/api"

import { api } from "./api"
import { clipKeys } from "./clip-query-keys"
import { feedKeys } from "./feed-queries"
import { gameKeys } from "./game-queries"
import { searchKeys } from "./search-api"

export const userKeys = {
  all: ["user"] as const,
  profile: (handle: string) => [...userKeys.all, "profile", handle] as const,
  profileViewer: (handle: string) =>
    [...userKeys.all, "profile-viewer", handle] as const,
  search: (q: string) => [...userKeys.all, "search", q] as const,
  storage: () => [...userKeys.all, "storage"] as const,
  tagged: (handle: string) => [...userKeys.all, "tagged", handle] as const,
  profileGamesInfinite: (handle: string, limit: number) =>
    [...userKeys.all, "profile-games-infinite", { handle, limit }] as const,
  followers: (handle: string) =>
    [...userKeys.all, "followers", handle] as const,
  following: (handle: string) =>
    [...userKeys.all, "following", handle] as const,
}

export function useUserSearchQuery(q: string) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: userKeys.search(trimmed),
    queryFn: () => api.users.search(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
  })
}

export function useTaggedClipsQuery(handle: string) {
  return useQuery({
    queryKey: userKeys.tagged(handle),
    queryFn: () => api.users.fetchTaggedClips(handle),
    enabled: handle.length > 0,
  })
}

export function useProfileGamesInfiniteQuery(
  handle: string,
  { limit = 24 }: { limit?: number } = {},
) {
  return useInfiniteQuery({
    queryKey: userKeys.profileGamesInfinite(handle, limit),
    queryFn: ({ pageParam }) =>
      api.users.fetchProfileGames(handle, {
        limit,
        offset: pageParam,
      }),
    enabled: handle.length > 0,
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length < limit
        ? undefined
        : pages.reduce((total, page) => total + page.length, 0),
  })
}

export function useUserFollowersQuery(
  handle: string,
  { enabled }: { enabled: boolean },
) {
  return useQuery({
    queryKey: userKeys.followers(handle),
    queryFn: () => api.users.fetchFollowers(handle),
    enabled: enabled && handle.length > 0,
    staleTime: 30_000,
  })
}

export function useUserFollowingQuery(
  handle: string,
  { enabled }: { enabled: boolean },
) {
  return useQuery({
    queryKey: userKeys.following(handle),
    queryFn: () => api.users.fetchFollowing(handle),
    enabled: enabled && handle.length > 0,
    staleTime: 30_000,
  })
}

export function useUserProfileQuery(handle: string) {
  return useQuery(userProfileQueryOptions(handle))
}

export function useUserProfileViewerQuery(handle: string) {
  return useQuery(userProfileViewerQueryOptions(handle))
}

export function userProfileQueryOptions(handle: string) {
  return queryOptions({
    queryKey: userKeys.profile(handle),
    queryFn: () => api.users.fetchProfile(handle),
    enabled: handle.length > 0,
    staleTime: 30_000,
  })
}

export function userProfileViewerQueryOptions(handle: string) {
  return queryOptions({
    queryKey: userKeys.profileViewer(handle),
    queryFn: () => api.users.fetchProfileViewer(handle),
    enabled: handle.length > 0,
    staleTime: 30_000,
  })
}

function setProfileViewerInCache(
  qc: QueryClient,
  handle: string,
  viewer: ProfileViewer,
) {
  qc.setQueryData<UserProfileViewer>(userKeys.profileViewer(handle), (old) =>
    old ? { ...old, viewer } : { viewer, counts: null },
  )
}

function adjustProfileFollowerCountInCache(
  qc: QueryClient,
  handle: string,
  delta: number,
) {
  qc.setQueryData<UserProfile>(userKeys.profile(handle), (old) =>
    old
      ? {
          ...old,
          counts: {
            ...old.counts,
            followers: Math.max(0, old.counts.followers + delta),
          },
        }
      : old,
  )
  qc.setQueryData<UserProfileViewer>(userKeys.profileViewer(handle), (old) =>
    old?.counts
      ? {
          ...old,
          counts: {
            ...old.counts,
            followers: Math.max(0, old.counts.followers + delta),
          },
        }
      : old,
  )
}

function setProfileFollowingInCache(
  qc: QueryClient,
  handle: string,
  next: boolean,
) {
  qc.setQueryData<UserProfileViewer>(userKeys.profileViewer(handle), (old) =>
    old?.viewer
      ? { ...old, viewer: { ...old.viewer, isFollowing: next } }
      : old,
  )
}

export function useProfileCachePatchers(handle: string) {
  const qc = useQueryClient()

  return {
    setViewer: (viewer: ProfileViewer) => {
      setProfileViewerInCache(qc, handle, viewer)
    },
    bumpFollowers: (delta: number) => {
      adjustProfileFollowerCountInCache(qc, handle, delta)
    },
  }
}

export async function invalidateProfileIdentityCaches(
  qc: QueryClient,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: userKeys.all }),
    qc.invalidateQueries({ queryKey: clipKeys.all }),
    qc.invalidateQueries({ queryKey: feedKeys.all }),
    qc.invalidateQueries({ queryKey: gameKeys.all }),
    qc.invalidateQueries({ queryKey: searchKeys.all }),
  ])
}

type UserFollowSnapshot = {
  profileKey: ReturnType<typeof userKeys.profile>
  viewerKey: ReturnType<typeof userKeys.profileViewer>
  previousProfile: UserProfile | undefined
  previousViewer: UserProfileViewer | undefined
}

export function useToggleUserFollowMutation(handle: string) {
  const qc = useQueryClient()

  return useMutation<void, Error, { next: boolean }, UserFollowSnapshot>({
    mutationFn: ({ next }) =>
      next ? api.users.follow(handle) : api.users.unfollow(handle),
    onMutate: async ({ next }) => {
      const profileKey = userKeys.profile(handle)
      const viewerKey = userKeys.profileViewer(handle)
      await Promise.all([
        qc.cancelQueries({ queryKey: profileKey }),
        qc.cancelQueries({ queryKey: viewerKey }),
      ])
      const previousProfile = qc.getQueryData<UserProfile>(profileKey)
      const previousViewer = qc.getQueryData<UserProfileViewer>(viewerKey)
      const wasFollowing = previousViewer?.viewer?.isFollowing ?? false
      const delta = next === wasFollowing ? 0 : next ? 1 : -1

      setProfileFollowingInCache(qc, handle, next)
      adjustProfileFollowerCountInCache(qc, handle, delta)

      return { profileKey, viewerKey, previousProfile, previousViewer }
    },
    onError: (_error, _variables, context) => {
      if (!context) return
      qc.setQueryData(context.profileKey, context.previousProfile)
      qc.setQueryData(context.viewerKey, context.previousViewer)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: userKeys.profile(handle) })
      void qc.invalidateQueries({ queryKey: userKeys.profileViewer(handle) })
      void qc.invalidateQueries({ queryKey: userKeys.followers(handle) })
      void qc.invalidateQueries({ queryKey: userKeys.following(handle) })
      void qc.invalidateQueries({ queryKey: feedKeys.all })
    },
  })
}
