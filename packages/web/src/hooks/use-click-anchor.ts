import { useCallback, useMemo, useRef, useState } from "react"
import type { PointerEvent } from "react"

export function useClickAnchor() {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: point.x,
          y: point.y,
          width: 1,
          height: 1,
        }),
    }),
    [point],
  )

  const onOpenChange = useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen
    setOpen(nextOpen)
  }, [])

  const onTriggerPointerDown = useCallback((e: PointerEvent) => {
    if (openRef.current) return
    setPoint({ x: e.clientX, y: e.clientY })
  }, [])

  return { anchor, open, onOpenChange, onTriggerPointerDown } as const
}
