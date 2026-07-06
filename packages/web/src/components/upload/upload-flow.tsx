import { type QueueClip } from "@alloy/api"
import { useNavigate } from "@tanstack/react-router"
import { Suspense, useCallback, useEffect, useMemo } from "react"

import type { AppSearch } from "@/lib/app-search"
import { useSuspenseSession } from "@/lib/session-suspense"

import type { PublishClipInput } from "./new-clip-helpers"
import { useUploadActions } from "./upload-flow-context"
import { useUploadQueueState } from "./upload-flow-queue-state"

export function UploadFlow() {
  return (
    <Suspense fallback={null}>
      <UploadFlowInner />
    </Suspense>
  )
}

function UploadFlowInner() {
  const session = useSuspenseSession()

  if (!session) return null

  return <AuthedUploadFlow />
}

function AuthedUploadFlow() {
  const { setPublishClip, setQueueState } = useUploadActions()
  const navigate = useNavigate()
  const handleOpenClip = useCallback(
    (row: QueueClip) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({
          ...prev,
          clip: row.id,
          comment: undefined,
        }),
        mask: row.gameSlug
          ? {
              to: "/games/$gameId/clips/$clipId",
              params: {
                gameId: row.gameSlug,
                clipId: row.id,
              },
            }
          : {
              to: "/clips/$clipId",
              params: { clipId: row.id },
            },
      })
    },
    [navigate],
  )
  const { runUpload, queue } = useUploadQueueState(handleOpenClip)

  const queueState = useMemo(() => ({ queue }), [queue])

  useEffect(() => {
    setQueueState(queueState)
  }, [queueState, setQueueState])

  useEffect(() => {
    return () => setQueueState(null)
  }, [setQueueState])

  const publishFromDesktopEditor = useCallback(
    async (payload: PublishClipInput) => {
      return runUpload(payload)
    },
    [runUpload],
  )

  useEffect(() => {
    setPublishClip(publishFromDesktopEditor)
    return () => {
      setPublishClip(null)
    }
  }, [publishFromDesktopEditor, setPublishClip])

  return null
}
