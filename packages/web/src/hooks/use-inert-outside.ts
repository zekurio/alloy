import { useEffect } from "react"
import type { RefObject } from "react"

/**
 * While `active`, makes everything outside `ref` inert, the way a modal
 * dialog does, for a view that covers the app without being portaled out of
 * it. Siblings along the element's ancestor chain stop taking focus and leave
 * the accessibility tree; the toast region stays live, so notifications about
 * the view are still announced.
 */
export function useInertOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const marked: Element[] = []
    let node: Element = element
    while (node.parentElement && node !== document.body) {
      const parent: Element = node.parentElement
      for (const sibling of parent.children) {
        if (sibling === node || sibling.hasAttribute("inert")) continue
        if (
          sibling.matches("[aria-live]") ||
          sibling.querySelector("[data-sonner-toaster]")
        ) {
          continue
        }
        sibling.setAttribute("inert", "")
        marked.push(sibling)
      }
      node = parent
    }
    return () => {
      for (const sibling of marked) sibling.removeAttribute("inert")
    }
  }, [active, ref])
}
