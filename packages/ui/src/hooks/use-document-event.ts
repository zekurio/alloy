"use client"

import { useEffect, useEffectEvent } from "react"

export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  const onEvent = useEffectEvent(listener)

  useEffect(() => {
    if (!enabled || !globalThis.document) return

    const handleEvent = (event: DocumentEventMap[K]) => {
      onEvent(event)
    }

    document.addEventListener(type, handleEvent, options)
    return () => document.removeEventListener(type, handleEvent, options)
  }, [type, options, enabled])
}
