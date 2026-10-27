/*
 * Enter/exit timings use tw-animate's `animation-duration-*`, never
 * Tailwind's `duration-*`. `duration-*` also sets `transition-duration`,
 * and with no `transition-property` that transitions every property, so a
 * resize or breakpoint change would ease the popup's size and position and
 * slide its contents around as they reflow.
 */

/**
 * Dialog timing: a settled ease-out entrance, and a quicker exit so closing
 * never feels like it lags behind the click. Shared by the backdrop and the
 * popup so the two move as one.
 */
export const DIALOG_MOTION_CLASS_NAME =
  "animation-duration-200 data-open:ease-[var(--ease-out)] data-closed:animation-duration-150 data-closed:ease-in"

/**
 * Menu, select, popover and tooltip timing: the shared fast duration and
 * ease-out curve, so small popups answer the click without a lag.
 */
export const POPUP_MOTION_CLASS_NAME =
  "animation-duration-[var(--duration-fast)] ease-[var(--ease-out)]"

type MotionDuration = "--duration-fast" | "--duration-base" | "--duration-slow"

const DURATION_FALLBACK_MS = {
  "--duration-fast": 120,
  "--duration-base": 180,
  "--duration-slow": 280,
} satisfies Record<MotionDuration, number>

/**
 * Runs a Web Animations API animation on the shared duration token and
 * ease-out curve, or nothing (null) when the user prefers reduced motion.
 */
export function animateWithMotionTokens(
  element: HTMLElement,
  keyframes: PropertyIndexedKeyframes,
  duration: MotionDuration = "--duration-base",
): Animation | null {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return null
  }
  const tokens = getComputedStyle(element)
  return element.animate(keyframes, {
    duration:
      cssTimeToMs(tokens.getPropertyValue(duration)) ??
      DURATION_FALLBACK_MS[duration],
    easing: tokens.getPropertyValue("--ease-out").trim() || "ease-out",
  })
}

/** "180ms" or ".18s" (production CSS is minified to the shorter form). */
function cssTimeToMs(value: string): number | null {
  const time = value.trim()
  const amount = Number.parseFloat(time)
  if (!Number.isFinite(amount)) return null
  if (time.endsWith("ms")) return amount
  if (time.endsWith("s")) return amount * 1000
  return null
}
