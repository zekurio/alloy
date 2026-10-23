/**
 * Base UI hides the backdrop of a modal that is nested inside another one
 * (`enabled: forceRender || !nested`). Alloy wants the opposite: a dialog,
 * alert, or drawer opened above another modal dims the layer beneath it — the
 * OAuth provider dialog over Settings, a delete alert over the clip viewer —
 * so every backdrop passes this.
 */
export const MODAL_OVERLAY_FORCE_RENDER = true

/**
 * Dialog and drawer footers render outline and secondary buttons as quiet
 * text buttons, so the primary action is the only filled control.
 */
export const MODAL_FOOTER_BUTTON_CLASS_NAME =
  "[&_[data-slot=button][data-variant=outline]]:!border-transparent [&_[data-slot=button][data-variant=outline]]:!bg-transparent [&_[data-slot=button][data-variant=outline]]:!text-foreground-muted [&_[data-slot=button][data-variant=outline]]:hover:!bg-surface-raised [&_[data-slot=button][data-variant=outline]]:hover:!text-foreground [&_[data-slot=button][data-variant=secondary]]:!border-transparent [&_[data-slot=button][data-variant=secondary]]:!bg-transparent [&_[data-slot=button][data-variant=secondary]]:!text-foreground-muted [&_[data-slot=button][data-variant=secondary]]:hover:!bg-surface-raised [&_[data-slot=button][data-variant=secondary]]:hover:!text-foreground"
