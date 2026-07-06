import { createContext, useContext } from "react"

import type { PublishClipInput } from "./new-clip-helpers"
import type { QueueItem } from "./upload-queue-types"

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
  setQueueState: (state: UploadQueueState | null) => void
  /** Stable delegate to the currently registered upload runner. */
  publishClip: PublishClipFn
  /**
   * Registers the upload runner (or unregisters with null). Backed by a ref —
   * not React state — so re-registering an unstable function identity cannot
   * cascade renders through the provider.
   */
  setPublishClip: (fn: PublishClipFn | null) => void
}

// Two contexts on purpose: upload progress changes frequently, while actions
// stay stable so publish-only consumers avoid per-progress re-renders.
export const UploadQueueContext = createContext<UploadQueueState | null>(null)
export const UploadActionsContext = createContext<UploadFlowActions | null>(
  null,
)

export function useUploadQueue(): UploadQueueState {
  const value = useContext(UploadQueueContext)
  if (!value) {
    throw new Error("useUploadQueue must be used within UploadFlowProvider")
  }
  return value
}

export function useUploadActions(): UploadFlowActions {
  const value = useContext(UploadActionsContext)
  if (!value) {
    throw new Error("useUploadActions must be used within UploadFlowProvider")
  }
  return value
}
