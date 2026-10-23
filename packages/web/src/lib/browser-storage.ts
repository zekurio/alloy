import { clientLogger } from "./client-log"

const warnedStorageFailures = new Set<string>()

function warnStorageFailure(action: string, key: string, cause: unknown): void {
  if (warnedStorageFailures.has(action)) return
  warnedStorageFailures.add(action)
  clientLogger.warn(
    `[storage] sessionStorage ${action} failed for ${key}.`,
    cause,
  )
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage
  } catch (cause) {
    warnStorageFailure("access", "sessionStorage", cause)
    return null
  }
}

export function readSessionStorageItem(key: string): string | null {
  const storage = sessionStorageOrNull()
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch (cause) {
    warnStorageFailure("read", key, cause)
    return null
  }
}

export function writeSessionStorageItem(key: string, value: string): boolean {
  const storage = sessionStorageOrNull()
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch (cause) {
    warnStorageFailure("write", key, cause)
    return false
  }
}
