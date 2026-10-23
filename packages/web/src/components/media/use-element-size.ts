import { useLayoutEffect, useState } from "react"
import type { RefObject } from "react"

/** The element's rendered size, kept current by a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const readSize = () => {
      const rect = element.getBoundingClientRect()
      setSize((current) => {
        if (current.width === rect.width && current.height === rect.height) {
          return current
        }
        return { width: rect.width, height: rect.height }
      })
    }

    readSize()
    const observer = new ResizeObserver(readSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}
