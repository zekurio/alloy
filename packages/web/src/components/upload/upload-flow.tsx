import { type QueueClip } from "@alloy/api"
import * as React from "react"

import { useSuspenseSession } from "@/lib/session-suspense"

import type { PublishPayload } from "./new-clip-helpers"
import { useUploadQueueState } from "./upload-flow-queue-state"
import { useUploadFlowControls } from "./use-upload-flow-controls"

export function UploadFlow() {
  return (
    <React.Suspense fallback={null}>
      <UploadFlowInner />
    </React.Suspense>
  )
}

function UploadFlowInner() {
  const session = useSuspenseSession()
  if (!session) return null

  return <AuthedUploadFlow />
}

function AuthedUploadFlow() {
  const { setActiveCount, setPublishClip } = useUploadFlowControls()
  const handleOpenClip = React.useCallback((_row: QueueClip) => undefined, [])
  const { runUpload, activeCount } = useUploadQueueState(false, handleOpenClip)

  React.useEffect(() => {
    setActiveCount(activeCount)
    return () => setActiveCount(0)
  }, [activeCount, setActiveCount])

  const publishFromExternalEditor = React.useCallback(
    async (payload: PublishPayload) => {
      return runUpload(payload)
    },
    [runUpload],
  )

  React.useEffect(() => {
    setPublishClip(publishFromExternalEditor)
    return () => {
      setPublishClip(null)
    }
  }, [publishFromExternalEditor, setPublishClip])

  return null
}
