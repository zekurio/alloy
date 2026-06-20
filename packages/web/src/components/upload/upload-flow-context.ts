import * as React from "react"

import type { PublishClipInput } from "./new-clip-helpers"
import type { QueueItem } from "./upload-queue-types"

export interface PublishClipResult {
  /** Server clip id once the upload is queued, or null when cancelled. */
  clipId: string | null
}

export type PublishClipFn = (
  payload: PublishClipInput,
) => Promise<PublishClipResult>

export interface UploadFlowControls {
  queue: QueueItem[]
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

export interface UploadQueueState {
  queue: QueueItem[]
}

export const UploadFlowContext = React.createContext<UploadFlowControls | null>(
  null,
)
