import {
  HttpError,
  type ProfileViewer,
  type UserProfileViewer,
} from "@alloy/api"
import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

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
}

export function invalidateStorageUsage(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: userKeys.storage() })
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

export function taggedClipsQueryOptions(handle: string) {
  return queryOptions({
    queryKey: userKeys.tagged(handle),
    queryFn: () => api.users.fetchTaggedClips(handle),
    enabled: handle.length > 0,
  })
}

export function useTaggedClipsQuery(handle: string) {
  return useQuery(taggedClipsQueryOptions(handle))
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
    queryFn: async () => {
      try {
        return await api.users.fetchProfileViewer(handle)
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          return { viewer: null, counts: null }
        }
        throw error
      }
    },
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

export function useProfileCachePatchers(handle: string) {
  const qc = useQueryClient()

  return {
    setViewer: (viewer: ProfileViewer) => {
      setProfileViewerInCache(qc, handle, viewer)
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
