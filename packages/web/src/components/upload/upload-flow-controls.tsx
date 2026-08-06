import { useCallback, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import {
  UploadActionsContext,
  type UploadFlowActions,
  type PublishClipFn,
  UploadQueueContext,
  type UploadQueueState,
  WebUploadActionContext,
} from "./upload-flow-context"
import { useWebUploadAction } from "./web-upload-action"

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

  const queueValue = useMemo<UploadQueueState>(
    () => ({ queue: queueState.queue }),
    [queueState.queue],
  )
  const actions = useMemo<UploadFlowActions>(
    () => ({
      setQueueState,
      publishClip,
      setPublishClip,
    }),
    [setQueueState, publishClip, setPublishClip],
  )
  const webUploadAction = useWebUploadAction(publishClip)

  return (
    <UploadActionsContext.Provider value={actions}>
      <UploadQueueContext.Provider value={queueValue}>
        <WebUploadActionContext.Provider value={webUploadAction}>
          {children}
        </WebUploadActionContext.Provider>
      </UploadQueueContext.Provider>
    </UploadActionsContext.Provider>
  )
}
