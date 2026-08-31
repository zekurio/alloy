import type { StorageDeletionNamespace } from "@alloy/db/schema"

const activeWrites = new Map<string, number>()

export async function withStorageObjectWriteActivity<T>(
  namespace: StorageDeletionNamespace,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const identity = writeIdentity(namespace, key)
  activeWrites.set(identity, (activeWrites.get(identity) ?? 0) + 1)
  try {
    return await operation()
  } finally {
    const remaining = (activeWrites.get(identity) ?? 1) - 1
    if (remaining > 0) activeWrites.set(identity, remaining)
    else activeWrites.delete(identity)
  }
}

export function storageObjectWriteIsActive(
  namespace: StorageDeletionNamespace,
  key: string,
): boolean {
  return activeWrites.has(writeIdentity(namespace, key))
}

function writeIdentity(
  namespace: StorageDeletionNamespace,
  key: string,
): string {
  return `${namespace}\0${key.toLowerCase()}`
}
