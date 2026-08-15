type EventSourceMessageListener = (event: MessageEvent<string>) => void

export function bindEventSourceListeners(
  source: EventSource,
  listeners: Record<string, EventSourceMessageListener>,
  onError?: (event: Event) => void,
): () => void {
  const entries = Object.entries(listeners)
  for (const [type, listener] of entries) {
    // SAFETY: These named SSE events always deliver MessageEvent<string>.
    source.addEventListener(type, listener as EventListener)
  }
  if (onError) source.addEventListener("error", onError)

  return () => {
    for (const [type, listener] of entries) {
      // SAFETY: This removes the same listener registered under the same event.
      source.removeEventListener(type, listener as EventListener)
    }
    if (onError) source.removeEventListener("error", onError)
  }
}
