"use client"

import * as React from "react"

export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true
): void {
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return
    window.addEventListener(type, listener as EventListener, options)
    return () =>
      window.removeEventListener(type, listener as EventListener, options)
  }, [type, listener, options, enabled])
}
