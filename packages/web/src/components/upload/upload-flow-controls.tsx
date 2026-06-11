import * as React from "react"

import { type PublishClipFn, UploadFlowContext } from "./upload-flow-context"

const publishUnavailable: PublishClipFn = () =>
  Promise.reject(new Error("Upload queue is not available."))

export function UploadFlowProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [queueOpen, setQueueOpen] = React.useState(false)
  const [activeCount, setActiveCount] = React.useState(0)
  const publishClipRef = React.useRef<PublishClipFn>(publishUnavailable)

  const publishClip = React.useCallback<PublishClipFn>(
    (payload) => publishClipRef.current(payload),
    [],
  )
  const setPublishClip = React.useCallback((fn: PublishClipFn | null) => {
    publishClipRef.current = fn ?? publishUnavailable
  }, [])

  const value = React.useMemo(
    () => ({
      queueOpen,
      setQueueOpen,
      activeCount,
      setActiveCount,
      publishClip,
      setPublishClip,
    }),
    [queueOpen, activeCount, publishClip, setPublishClip],
  )

  return (
    <UploadFlowContext.Provider value={value}>
      {children}
    </UploadFlowContext.Provider>
  )
}
