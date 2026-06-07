/**
 * Bridge exposed by the Alloy desktop shell's main-window preload. Absent in a
 * browser.
 */
interface AlloyDesktop {
  platform: string
  titlebarOverlay: boolean
  openSettings(): Promise<void>
}

export function alloyDesktop(): AlloyDesktop | null {
  return (globalThis as { alloyDesktop?: AlloyDesktop }).alloyDesktop ?? null
}
