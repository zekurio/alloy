"use client"

import { useEffect } from "react"

export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return
    window.addEventListener(type, listener as EventListener, options)
    return () =>
      window.removeEventListener(type, listener as EventListener, options)
  }, [type, listener, options, enabled])
}
