import { type QueueClip } from "@alloy/api"
import { useMemo } from "react"

import {
  useReEncodeClipMutation,
  useUploadQueueQuery,
} from "@/lib/clip-queries"

import { useRunUpload } from "./upload-flow-active-upload"
import { useUploadQueueItems } from "./upload-flow-queue-items"
import {
  useCancelQueueRow,
  useReleaseRetainedThumbnail,
  useServerQueueSync,
  useUploadQueueRuntime,
} from "./upload-flow-queue-runtime"
import { useDismissedClips } from "./use-dismissed-clips"

export function useUploadQueueState(onOpenClip: (row: QueueClip) => void) {
  const runtime = useUploadQueueRuntime()
  const { data: serverQueueData } = useUploadQueueQuery({ enabled: true })
  const serverQueue = useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData],
  )

  useServerQueueSync(
    serverQueue,
    runtime.activeRef,
    runtime.retainedThumbsRef,
    runtime.bump,
  )
  const uploads = useRunUpload(
    runtime.activeRef,
    runtime.retainedThumbsRef,
    runtime.bump,
  )
  const cancelRow = useCancelQueueRow(
    runtime.activeRef,
    runtime.retainedThumbsRef,
    runtime.bump,
  )
  // Depend on mutate, not the mutation result object, which changes every render.
  const reEncodeClip = useReEncodeClipMutation().mutate
  const releaseRetainedThumb = useReleaseRetainedThumbnail(
    runtime.retainedThumbsRef,
    runtime.bump,
  )
  const dismissedClips = useDismissedClips(
    serverQueue,
    serverQueueData !== undefined,
  )
  const queue = useUploadQueueItems(
    runtime.queueVersion,
    runtime.activeRef,
    runtime.retainedThumbsRef,
    serverQueue,
    dismissedClips.dismissed,
    {
      cancelRow,
      retryUpload: uploads.retryUpload,
      reEncodeClip,
      onOpenClip,
      dismiss: dismissedClips.dismiss,
      releaseRetainedThumb,
    },
  )

  return { runUpload: uploads.runUpload, queue }
}
