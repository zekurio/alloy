import { clientLogger } from "./client-log"

export function isFullscreenElement(
  target: Element | null | undefined
): boolean {
  if (typeof document === "undefined") return false
  return Boolean(target && document.fullscreenElement === target)
}

export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false
  return Boolean(document.fullscreenEnabled)
}

export function requestFullscreenBestEffort(
  target: Element,
  label: string
): void {
  if (typeof target.requestFullscreen !== "function") return
  void target.requestFullscreen().catch((cause) => {
    clientLogger.warn(`[fullscreen] Failed to enter ${label}.`, cause)
  })
}

export function exitFullscreenBestEffort(label: string): void {
  if (typeof document === "undefined") return
  if (!document.fullscreenElement) return
  if (typeof document.exitFullscreen !== "function") return
  void document.exitFullscreen().catch((cause) => {
    clientLogger.warn(`[fullscreen] Failed to exit ${label}.`, cause)
  })
}
