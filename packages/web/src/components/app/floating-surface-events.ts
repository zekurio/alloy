import { useWindowEvent } from "alloy-ui/hooks/use-window-event"

export type FloatingSurface = "notifications" | "uploads"

const FLOATING_SURFACE_OPEN_EVENT = "alloy:floating-surface-open"

declare global {
  interface WindowEventMap {
    [FLOATING_SURFACE_OPEN_EVENT]: CustomEvent<FloatingSurface>
  }
}

export function announceFloatingSurfaceOpen(surface: FloatingSurface) {
  window.dispatchEvent(
    new CustomEvent<FloatingSurface>(FLOATING_SURFACE_OPEN_EVENT, {
      detail: surface,
    }),
  )
}

export function useFloatingSurfaceOpenListener(
  callback: (surface: FloatingSurface) => void,
) {
  useWindowEvent(FLOATING_SURFACE_OPEN_EVENT, (event) => {
    callback(event.detail)
  })
}
