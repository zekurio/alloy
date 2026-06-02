import { clientLogger } from "./client-log"

type ObjectUrlSource = Blob | MediaSource

export function createObjectUrl(
  source: ObjectUrlSource,
  label: string,
): string | null {
  try {
    return URL.createObjectURL(source)
  } catch (cause) {
    clientLogger.warn(`[object-url] Failed to create ${label}.`, cause)
    return null
  }
}

export function requireObjectUrl(
  source: ObjectUrlSource,
  label: string,
): string {
  const url = createObjectUrl(source, label)
  if (!url) throw new Error(`Could not create ${label}`)
  return url
}

export function revokeObjectUrl(
  url: string | null | undefined,
  label: string,
): void {
  if (!url) return
  try {
    URL.revokeObjectURL(url)
  } catch (cause) {
    clientLogger.warn(`[object-url] Failed to revoke ${label}.`, cause)
  }
}

export function scheduleObjectUrlRevoke(url: string, label: string): void {
  globalThis.setTimeout(() => revokeObjectUrl(url, label), 0)
}
