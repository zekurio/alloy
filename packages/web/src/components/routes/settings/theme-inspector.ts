import {
  THEME_COLOR_ROLES,
  THEME_COLOR_VARIABLES,
  type ThemeColorRole,
} from "@alloy/ui/lib/theme-colors"
import { useEffect, useEffectEvent, useState } from "react"

/** Unlikely to be any theme's real color, so a match means "this role". */
const PROBE_COLOR = "#01fea7"
/** Nearest ancestors checked; past that a hit rarely means the clicked thing. */
const PROBE_DEPTH = 6
/** Marks the editor so its own clicks never count as picks. */
const THEME_EDITOR_SELECTOR = "[data-theme-editor]"

/**
 * Finds the role that paints `target`: each role's custom properties are set
 * to a probe color in turn, and the first role that changes the element (or
 * its nearest ancestor) wins — fill before border before text.
 */
export function inspectThemeRole(target: Element): ThemeColorRole | null {
  const chain: Element[] = []
  for (
    let element: Element | null = target;
    element && chain.length < PROBE_DEPTH;
    element = element.parentElement
  ) {
    chain.push(element)
  }

  const root = document.documentElement
  // Transitions would hide the swap from getComputedStyle; see globals.css.
  root.setAttribute("data-theme-probe", "")
  const baseline = paints(chain)
  let best: { role: ThemeColorRole; rank: number } | null = null
  for (const role of THEME_COLOR_ROLES) {
    const variables = THEME_COLOR_VARIABLES[role]
    for (const variable of variables) {
      root.style.setProperty(variable, PROBE_COLOR)
    }
    const probed = paints(chain)
    for (const variable of variables) root.style.removeProperty(variable)

    const rank = probed.findIndex((paint, index) => paint !== baseline[index])
    if (rank !== -1 && (!best || rank < best.rank)) best = { role, rank }
  }
  // Settle the restored values before transitions come back, so nothing
  // animates from the probe color.
  paints(chain)
  root.removeAttribute("data-theme-probe")
  return best?.role ?? null
}

/**
 * Each element's fill, drawn border, and text, flattened in rank order. Text
 * color is inherited everywhere, so it only counts where the element paints
 * text or an icon itself; otherwise a click on a card's empty space would
 * name the text color instead of the card.
 */
function paints(chain: readonly Element[]): string[] {
  return chain.flatMap((element) => {
    const style = getComputedStyle(element)
    const bordered = ["top", "right", "bottom", "left"].some(
      (side) => style.getPropertyValue(`border-${side}-width`) !== "0px",
    )
    return [
      style.backgroundColor,
      bordered ? style.borderTopColor : "",
      paintsText(element) ? style.color : "",
    ]
  })
}

function paintsText(element: Element): boolean {
  if (element instanceof SVGElement) return true
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  )
}

/**
 * While active, hovering anything outside the editor outlines it and a click
 * picks its role instead of activating it. Escape cancels.
 */
export function useThemeInspector(
  active: boolean,
  onPick: (role: ThemeColorRole | null) => void,
  onCancel: () => void,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const pick = useEffectEvent(onPick)
  const cancel = useEffectEvent(onCancel)

  useEffect(() => {
    if (!active) return
    const outsideEditor = (target: EventTarget | null): Element | null =>
      target instanceof Element && !target.closest(THEME_EDITOR_SELECTOR)
        ? target
        : null

    const hover = (event: PointerEvent) => {
      const element = outsideEditor(event.target)
      setRect(element ? element.getBoundingClientRect() : null)
    }
    const swallow = (event: Event) => {
      if (!outsideEditor(event.target)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const click = (event: MouseEvent) => {
      const element = outsideEditor(event.target)
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      pick(inspectThemeRole(element))
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }

    const root = document.documentElement
    root.setAttribute("data-theme-inspecting", "")
    document.addEventListener("pointerover", hover, true)
    document.addEventListener("pointerdown", swallow, true)
    document.addEventListener("mousedown", swallow, true)
    document.addEventListener("click", click, true)
    document.addEventListener("keydown", escape, true)
    return () => {
      root.removeAttribute("data-theme-inspecting")
      document.removeEventListener("pointerover", hover, true)
      document.removeEventListener("pointerdown", swallow, true)
      document.removeEventListener("mousedown", swallow, true)
      document.removeEventListener("click", click, true)
      document.removeEventListener("keydown", escape, true)
      setRect(null)
    }
  }, [active])

  return rect
}
