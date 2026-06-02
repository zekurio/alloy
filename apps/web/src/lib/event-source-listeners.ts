type EventSourceMessageListener = (event: MessageEvent<string>) => void

export function bindEventSourceListeners(
  source: EventSource,
  listeners: Record<string, EventSourceMessageListener>,
  onError?: (event: Event) => void,
): () => void {
  const entries = Object.entries(listeners)
  for (const [type, listener] of entries) {
    source.addEventListener(type, listener as EventListener)
  }
  if (onError) source.addEventListener("error", onError)

  return () => {
    for (const [type, listener] of entries) {
      source.removeEventListener(type, listener as EventListener)
    }
    if (onError) source.removeEventListener("error", onError)
  }
}
