import * as React from "react"

import { scheduleBrowserIdleTask } from "@/lib/browser-idle"

export const loadNewClipDialog = () => import("./new-clip-dialog")

export const NewClipDialog = React.lazy(() =>
  loadNewClipDialog().then((m) => ({ default: m.NewClipDialog }))
)

export function useWarmEditor(
  queueOpen: boolean,
  setMounted: (mounted: boolean) => void,
) {
  React.useEffect(() => {
    if (!queueOpen) return
    const warmEditor = () => {
      setMounted(true)
      void loadNewClipDialog()
    }
    return scheduleBrowserIdleTask(warmEditor, {
      timeoutMs: 1200,
      fallbackDelayMs: 250,
    })
  }, [queueOpen, setMounted])
}
