import { type QueueClip } from "@alloy/api"
import { useNavigate } from "@tanstack/react-router"
import * as React from "react"

import type { AppSearch } from "@/lib/app-search"
import { alloyDesktop } from "@/lib/desktop"
import { useSuspenseSession } from "@/lib/session-suspense"

import type { PublishClipInput } from "./new-clip-helpers"
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
  const desktop = alloyDesktop()

  if (!session || !desktop) return null

  return <AuthedDesktopUploadFlow />
}

function AuthedDesktopUploadFlow() {
  const { setPublishClip, setQueueState } = useUploadFlowControls()
  const navigate = useNavigate()
  const handleOpenClip = React.useCallback(
    (row: QueueClip) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({
          ...prev,
          clip: row.id,
          comment: undefined,
        }),
        ...(row.steamgriddbId
          ? {
              mask: {
                to: "/games/$gameId/c/$clipId",
                params: {
                  gameId: String(row.steamgriddbId),
                  clipId: row.id,
                },
              },
            }
          : {}),
      })
    },
    [navigate],
  )
  const { runUpload, queue } = useUploadQueueState(handleOpenClip)

  const queueState = React.useMemo(() => ({ queue }), [queue])

  React.useEffect(() => {
    setQueueState(queueState)
  }, [queueState, setQueueState])

  React.useEffect(() => {
    return () => setQueueState(null)
  }, [setQueueState])

  const publishFromDesktopEditor = React.useCallback(
    async (payload: PublishClipInput) => {
      return runUpload(payload)
    },
    [runUpload],
  )

  React.useEffect(() => {
    setPublishClip(publishFromDesktopEditor)
    return () => {
      setPublishClip(null)
    }
  }, [publishFromDesktopEditor, setPublishClip])

  return null
}
