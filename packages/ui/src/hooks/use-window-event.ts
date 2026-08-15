"use client"

import { useEffect, useRef } from "react"

export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  const listenerRef = useRef(listener)

  useEffect(() => {
    listenerRef.current = listener
  }, [listener])

  useEffect(() => {
    if (!enabled || !globalThis.window) return

    const handleEvent = (event: WindowEventMap[K]) => {
      listenerRef.current(event)
    }

    window.addEventListener(type, handleEvent, options)
    return () => window.removeEventListener(type, handleEvent, options)
  }, [type, options, enabled])
}
