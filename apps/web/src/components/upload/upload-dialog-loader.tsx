import * as React from "react"

export const loadNewClipDialog = () => import("./new-clip-dialog")

export const NewClipDialog = React.lazy(() =>
  loadNewClipDialog().then((m) => ({ default: m.NewClipDialog }))
)

export function useWarmEditor(
  queueOpen: boolean,
  setMounted: (mounted: boolean) => void
) {
  React.useEffect(() => {
    if (!queueOpen) return
    const warmEditor = () => {
      setMounted(true)
      void loadNewClipDialog()
    }
    if (typeof window === "undefined") return
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warmEditor, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const timeout = globalThis.setTimeout(warmEditor, 250)
    return () => globalThis.clearTimeout(timeout)
  }, [queueOpen, setMounted])
}
