"use client"

import { useEffect, useEffectEvent } from "react"

export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  const onEvent = useEffectEvent(listener)

  useEffect(() => {
    if (!enabled || !globalThis.window) return

    const handleEvent = (event: WindowEventMap[K]) => {
      onEvent(event)
    }

    window.addEventListener(type, handleEvent, options)
    return () => window.removeEventListener(type, handleEvent, options)
  }, [type, options, enabled])
}
