"use client"

import * as React from "react"

export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  React.useEffect(() => {
    if (!enabled || typeof document === "undefined") return
    document.addEventListener(type, listener as EventListener, options)
    return () =>
      document.removeEventListener(type, listener as EventListener, options)
  }, [type, listener, options, enabled])
}
