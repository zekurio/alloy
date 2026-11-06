import type { MouseEvent } from "react"

/**
 * True for an unmodified primary-button click that nothing else has handled.
 * Links that open in place handle these and leave the rest (middle-click,
 * Ctrl/Cmd/Shift/Alt+click) to the browser.
 */
export function isPlainPrimaryClick(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}
