import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { ReactNode } from "react"
import { useStore } from "zustand"

import { useInvalidateClips } from "@/lib/clip-queries"

import {
  UploadQueueStoreContext,
  WebUploadActionContext,
} from "./upload-flow-context"
import { createUploadQueueStore } from "./upload-queue-store"
import { useWebUploadAction } from "./web-upload-action"

export function UploadFlowProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const invalidateClips = useInvalidateClips()
  const [store] = useState(() =>
    createUploadQueueStore(queryClient, invalidateClips),
  )
  const publishClip = useStore(store, (state) => state.publishClip)
  const webUploadAction = useWebUploadAction(publishClip)

  return (
    <UploadQueueStoreContext.Provider value={store}>
      <WebUploadActionContext.Provider value={webUploadAction}>
        {children}
      </WebUploadActionContext.Provider>
    </UploadQueueStoreContext.Provider>
  )
}
