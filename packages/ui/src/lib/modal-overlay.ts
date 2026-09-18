/**
 * Base UI hides the backdrop of a modal that is nested inside another one
 * (`enabled: forceRender || !nested`). Alloy wants the opposite: a dialog,
 * alert, or drawer opened above another modal dims the layer beneath it — the
 * OAuth provider dialog over Settings, a delete alert over the clip viewer —
 * so every backdrop passes this.
 */
export const MODAL_OVERLAY_FORCE_RENDER = true

export const MODAL_OVERLAY_CLASS_NAME =
  "fixed inset-0 isolate z-50 bg-[oklch(12%_0.01_250)]/60"
