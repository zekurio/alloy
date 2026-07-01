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
    if (!enabled || typeof window === "undefined") return

    const handleEvent: EventListener = (event) => {
      listenerRef.current(event as WindowEventMap[K])
    }

    window.addEventListener(type, handleEvent, options)
    return () => window.removeEventListener(type, handleEvent, options)
  }, [type, options, enabled])
}
