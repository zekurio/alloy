import type {
  PublishStagingInput,
  RecordingKind,
  StagingRecordingRow,
  UpdateStagingInput,
} from "@alloy/api"
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { api } from "./api"
import { clipKeys } from "./clip-query-keys"
import { stagingKeys } from "./staging-query-keys"
import { invalidateStorageUsage } from "./user-queries"

export { stagingKeys }

export function useStagingListQuery(kind?: RecordingKind) {
  return useQuery({
    queryKey: stagingKeys.list(kind),
    queryFn: () => api.staging.fetch({ kind }),
  })
}

export function stagingDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: stagingKeys.detail(id),
    queryFn: () => api.staging.fetchById(id),
    enabled: id.length > 0,
    refetchInterval: (query) => {
      const row = query.state.data
      if (!row) return false
      return row.status === "processing" || row.encodeProgress < 100
        ? 2500
        : false
    },
    placeholderData: (previous) => previous,
  })
}

export function useStagingQuery(id: string) {
  return useQuery(stagingDetailQueryOptions(id))
}

function patchStagingDetail(qc: QueryClient, row: StagingRecordingRow): void {
  qc.setQueryData<StagingRecordingRow>(stagingKeys.detail(row.id), row)
}

export function useUpdateStagingMutation() {
  const qc = useQueryClient()
  return useMutation<
    StagingRecordingRow,
    Error,
    { id: string; input: UpdateStagingInput }
  >({
    mutationFn: ({ id, input }) => api.staging.update(id, input),
    onSuccess: (row) => patchStagingDetail(qc, row),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: stagingKeys.all })
    },
  })
}

export function useTrimStagingMutation() {
  const qc = useQueryClient()
  return useMutation<
    StagingRecordingRow,
    Error,
    { id: string; startMs: number; endMs: number }
  >({
    mutationFn: ({ id, startMs, endMs }) =>
      api.staging.trim(id, { startMs, endMs }),
    onSuccess: (row) => patchStagingDetail(qc, row),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: stagingKeys.all })
      void invalidateStorageUsage(qc)
    },
  })
}

/** Drop a staging row from every cached list immediately (no refetch wait). */
function removeStagingFromLists(qc: QueryClient, id: string): void {
  qc.setQueriesData<StagingRecordingRow[] | undefined>(
    { queryKey: stagingKeys.lists() },
    (old) => old?.filter((row) => row.id !== id),
  )
}

export function useDeleteStagingMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.staging.delete(id),
    onSuccess: (_data, { id }) => {
      qc.removeQueries({ queryKey: stagingKeys.detail(id) })
      removeStagingFromLists(qc, id)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: stagingKeys.lists() })
      void invalidateStorageUsage(qc)
    },
  })
}

export function usePublishStagingMutation() {
  const qc = useQueryClient()
  return useMutation<
    { clipId: string },
    Error,
    { id: string; input: PublishStagingInput }
  >({
    mutationFn: ({ id, input }) => api.staging.publish(id, input),
    onSuccess: (_data, { id }) => {
      // The staging row is consumed into a clip (which reuses its id); drop it
      // from the caches right away and refetch the clip lists so the published
      // clip shows up in its place.
      qc.removeQueries({ queryKey: stagingKeys.detail(id) })
      removeStagingFromLists(qc, id)
      void qc.invalidateQueries({ queryKey: stagingKeys.lists() })
      void qc.invalidateQueries({ queryKey: clipKeys.all })
      void invalidateStorageUsage(qc)
    },
  })
}
