import { useCallback, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import {
  type PublishClipFn,
  UploadFlowContext,
  type UploadQueueState,
} from "./upload-flow-context"

const publishUnavailable: PublishClipFn = () =>
  Promise.reject(new Error("Upload queue is not available."))

const emptyQueueState: UploadQueueState = {
  queue: [],
}

export function UploadFlowProvider({ children }: { children: ReactNode }) {
  const [queueState, setQueueStateValue] =
    useState<UploadQueueState>(emptyQueueState)
  const publishClipRef = useRef<PublishClipFn>(publishUnavailable)

  const publishClip = useCallback<PublishClipFn>(
    (payload) => publishClipRef.current(payload),
    [],
  )
  const setPublishClip = useCallback((fn: PublishClipFn | null) => {
    publishClipRef.current = fn ?? publishUnavailable
  }, [])
  const setQueueState = useCallback((state: UploadQueueState | null) => {
    setQueueStateValue(state ?? emptyQueueState)
  }, [])

  const value = useMemo(
    () => ({
      ...queueState,
      setQueueState,
      publishClip,
      setPublishClip,
    }),
    [queueState, setQueueState, publishClip, setPublishClip],
  )

  return (
    <UploadFlowContext.Provider value={value}>
      {children}
    </UploadFlowContext.Provider>
  )
}
