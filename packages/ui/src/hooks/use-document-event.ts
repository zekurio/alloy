"use client"

import { useEffect, useRef } from "react"

export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
  enabled = true,
): void {
  const listenerRef = useRef(listener)

  useEffect(() => {
    listenerRef.current = listener
  }, [listener])

  useEffect(() => {
    if (!enabled || !globalThis.document) return

    const handleEvent = (event: DocumentEventMap[K]) => {
      listenerRef.current(event)
    }

    document.addEventListener(type, handleEvent, options)
    return () => document.removeEventListener(type, handleEvent, options)
  }, [type, options, enabled])
}
