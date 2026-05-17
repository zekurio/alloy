export type FloatingSurface = "notifications" | "uploads"

const FLOATING_SURFACE_OPEN_EVENT = "alloy:floating-surface-open"

export function announceFloatingSurfaceOpen(surface: FloatingSurface) {
  window.dispatchEvent(
    new CustomEvent<FloatingSurface>(FLOATING_SURFACE_OPEN_EVENT, {
      detail: surface,
    })
  )
}

export function subscribeToFloatingSurfaceOpen(
  callback: (surface: FloatingSurface) => void
) {
  const listener = (event: Event) => {
    callback((event as CustomEvent<FloatingSurface>).detail)
  }

  window.addEventListener(FLOATING_SURFACE_OPEN_EVENT, listener)
  return () => window.removeEventListener(FLOATING_SURFACE_OPEN_EVENT, listener)
}
