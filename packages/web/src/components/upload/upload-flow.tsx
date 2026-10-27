import { Suspense, useEffect } from "react"
import { useStore } from "zustand"

import { useUploadQueueQuery } from "@/lib/clip-queries"
import { useSuspenseSession } from "@/lib/session-suspense"

import { useUploadQueueStore } from "./upload-flow-context"
import { hasUploadInFlight } from "./upload-queue-store"

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
  const store = useUploadQueueStore()
  // Opens the server queue stream that feeds the query cache.
  useUploadQueueQuery({ enabled: true })
  useEffect(() => store.getState().attach(), [store])

  const uploadInFlight = useStore(store, (state) =>
    hasUploadInFlight(state.active),
  )
  useEffect(() => {
    if (!uploadInFlight) return
    // Leaving the page drops the transfer and its prepared media, so ask
    // first while any upload still has work left on this page.
    const confirmLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // WebKit and older engines only prompt when returnValue is set.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", confirmLeave)
    return () => window.removeEventListener("beforeunload", confirmLeave)
  }, [uploadInFlight])

  return null
}
