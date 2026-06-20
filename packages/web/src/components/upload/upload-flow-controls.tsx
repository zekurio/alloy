import * as React from "react"

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

export function UploadFlowProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [queueState, setQueueStateValue] =
    React.useState<UploadQueueState>(emptyQueueState)
  const publishClipRef = React.useRef<PublishClipFn>(publishUnavailable)

  const publishClip = React.useCallback<PublishClipFn>(
    (payload) => publishClipRef.current(payload),
    [],
  )
  const setPublishClip = React.useCallback((fn: PublishClipFn | null) => {
    publishClipRef.current = fn ?? publishUnavailable
  }, [])
  const setQueueState = React.useCallback((state: UploadQueueState | null) => {
    setQueueStateValue(state ?? emptyQueueState)
  }, [])

  const value = React.useMemo(
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
