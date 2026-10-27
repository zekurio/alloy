import { type QueueClip } from "@alloy/api"
import { createContext, useCallback, useContext, useMemo } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { useOpenClipDialog } from "@/lib/clip-navigation"
import {
  useReEncodeClipMutation,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { useDismissQueueClipMutation } from "@/lib/clip-queue-dismissal-queries"

import type { PublishClipInput } from "./new-clip-helpers"
import { useUploadQueueItems } from "./upload-flow-queue-items"
import type { UploadQueueStore } from "./upload-queue-store"
import type { QueueItem } from "./upload-queue-types"
import type { WebUploadAction } from "./web-upload-action"

export interface PublishClipResult {
  /** Server clip id once the upload is queued, or null when cancelled. */
  clipId: string | null
}

export type PublishClipFn = (
  payload: PublishClipInput,
) => Promise<PublishClipResult>

export interface UploadQueueState {
  queue: QueueItem[]
}

export interface UploadFlowActions {
  publishClip: PublishClipFn
}

export const UploadQueueStoreContext = createContext<UploadQueueStore | null>(
  null,
)
export const WebUploadActionContext = createContext<WebUploadAction | null>(
  null,
)

export function useUploadQueueStore(): UploadQueueStore {
  const store = useContext(UploadQueueStoreContext)
  if (!store) {
    throw new Error(
      "useUploadQueueStore must be used within UploadFlowProvider",
    )
  }
  return store
}

/**
 * The app-wide queue: this page's local uploads, the server's queue (kept in
 * the query cache by the stream UploadFlow opens) and desktop downloads.
 */
export function useUploadQueue(): UploadQueueState {
  const store = useUploadQueueStore()
  const {
    active,
    retainedThumbs,
    cancelRow,
    retryUpload,
    releaseRetainedThumb,
  } = useStore(
    store,
    useShallow((state) => ({
      active: state.active,
      retainedThumbs: state.retainedThumbs,
      cancelRow: state.cancelRow,
      retryUpload: state.retryUpload,
      releaseRetainedThumb: state.releaseRetainedThumb,
    })),
  )
  const { data: serverQueueData } = useUploadQueueQuery({ enabled: false })
  const serverQueue = useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData],
  )
  // Depend on mutate, not the mutation result object, which changes every render.
  const reEncodeClip = useReEncodeClipMutation().mutate
  const dismiss = useDismissQueueClipMutation().mutate
  const openClipDialog = useOpenClipDialog()
  const onOpenClip = useCallback(
    (row: QueueClip) => openClipDialog(row.id, row.gameSlug),
    [openClipDialog],
  )
  const queue = useUploadQueueItems(active, retainedThumbs, serverQueue, {
    cancelRow,
    retryUpload,
    reEncodeClip,
    onOpenClip,
    dismiss,
    releaseRetainedThumb,
  })
  return useMemo(() => ({ queue }), [queue])
}

export function useUploadActions(): UploadFlowActions {
  const publishClip = useStore(
    useUploadQueueStore(),
    (state) => state.publishClip,
  )
  return useMemo(() => ({ publishClip }), [publishClip])
}

export function useWebUploadActionContext(): WebUploadAction {
  const value = useContext(WebUploadActionContext)
  if (!value) {
    throw new Error(
      "useWebUploadActionContext must be used within UploadFlowProvider",
    )
  }
  return value
}
