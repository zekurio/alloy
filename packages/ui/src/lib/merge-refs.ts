import type { Ref, RefCallback } from "react"

/**
 * Callback ref that points every given ref at the same node. A cleanup
 * returned by a React 19 callback ref runs on detach in place of a `null`
 * call, matching how React treats that ref on its own.
 */
export function mergeRefs<T>(
  ...refs: ReadonlyArray<Ref<T> | undefined>
): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => assignRef(ref, node))
    return () => {
      refs.forEach((ref, index) => {
        const cleanup = cleanups[index]
        if (cleanup) cleanup()
        else assignRef(ref, null)
      })
    }
  }
}

function assignRef<T>(
  ref: Ref<T> | undefined,
  node: T | null,
): (() => void) | undefined {
  if (!ref) return undefined
  if ("current" in ref) {
    ref.current = node
    return undefined
  }
  return ref(node) ?? undefined
}
