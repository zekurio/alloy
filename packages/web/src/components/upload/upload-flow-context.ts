import * as React from "react"

import type { PublishPayload } from "./new-clip-helpers"

export interface PublishClipResult {
  /** Server clip id, or null when the upload was cancelled. */
  clipId: string | null
}

export type PublishClipFn = (
  payload: PublishPayload,
) => Promise<PublishClipResult>

export interface UploadFlowControls {
  queueOpen: boolean
  setQueueOpen: React.Dispatch<React.SetStateAction<boolean>>
  activeCount: number
  setActiveCount: React.Dispatch<React.SetStateAction<number>>
  /** Stable delegate to the currently registered upload runner. */
  publishClip: PublishClipFn
  /**
   * Registers the upload runner (or unregisters with null). Backed by a ref —
   * not React state — so re-registering an unstable function identity cannot
   * cascade renders through the provider.
   */
  setPublishClip: (fn: PublishClipFn | null) => void
}

export const UploadFlowContext = React.createContext<UploadFlowControls | null>(
  null,
)
