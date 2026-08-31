type StorageDeletionWakeListener = () => void

const listeners = new Set<StorageDeletionWakeListener>()

export function publishStorageDeletionWake(): void {
  for (const listener of listeners) listener()
}

export function subscribeStorageDeletionWake(
  listener: StorageDeletionWakeListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
