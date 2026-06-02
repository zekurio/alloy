import { clientLogger } from "./client-log"

type BrowserStorageKind = "localStorage" | "sessionStorage"

const warnedStorageFailures = new Set<string>()

function storageLabel(kind: BrowserStorageKind): string {
  return kind
}

function warnStorageFailure(
  kind: BrowserStorageKind,
  action: string,
  key: string,
  cause: unknown
): void {
  const warningKey = `${kind}:${action}`
  if (warnedStorageFailures.has(warningKey)) return
  warnedStorageFailures.add(warningKey)
  clientLogger.warn(
    `[storage] ${storageLabel(kind)} ${action} failed for ${key}.`,
    cause
  )
}

function browserStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window[kind]
  } catch (cause) {
    warnStorageFailure(kind, "access", kind, cause)
    return null
  }
}

function readStorageItem(kind: BrowserStorageKind, key: string): string | null {
  const storage = browserStorage(kind)
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch (cause) {
    warnStorageFailure(kind, "read", key, cause)
    return null
  }
}

function writeStorageItem(
  kind: BrowserStorageKind,
  key: string,
  value: string
): boolean {
  const storage = browserStorage(kind)
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch (cause) {
    warnStorageFailure(kind, "write", key, cause)
    return false
  }
}

function removeStorageItem(kind: BrowserStorageKind, key: string): boolean {
  const storage = browserStorage(kind)
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch (cause) {
    warnStorageFailure(kind, "remove", key, cause)
    return false
  }
}

export function readLocalStorageItem(key: string): string | null {
  return readStorageItem("localStorage", key)
}

export function writeLocalStorageItem(key: string, value: string): boolean {
  return writeStorageItem("localStorage", key, value)
}

export function removeLocalStorageItem(key: string): boolean {
  return removeStorageItem("localStorage", key)
}

export function readSessionStorageItem(key: string): string | null {
  return readStorageItem("sessionStorage", key)
}

export function writeSessionStorageItem(key: string, value: string): boolean {
  return writeStorageItem("sessionStorage", key, value)
}
