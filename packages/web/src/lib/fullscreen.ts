import { clientLogger } from "./client-log"

export function isFullscreenElement(
  target: Element | null | undefined,
): boolean {
  if (!globalThis.document) return false
  return Boolean(target && document.fullscreenElement === target)
}

export function isFullscreenSupported(): boolean {
  if (!globalThis.document) return false
  return Boolean(document.fullscreenEnabled)
}

export function requestFullscreenBestEffort(
  target: Element,
  label: string,
): void {
  if (!target.requestFullscreen) return
  void target.requestFullscreen().catch((cause) => {
    clientLogger.warn(`[fullscreen] Failed to enter ${label}.`, cause)
  })
}

export function exitFullscreenBestEffort(label: string): void {
  if (!globalThis.document) return
  if (!document.fullscreenElement) return
  if (!document.exitFullscreen) return
  void document.exitFullscreen().catch((cause) => {
    clientLogger.warn(`[fullscreen] Failed to exit ${label}.`, cause)
  })
}
