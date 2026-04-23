import * as React from "react"

export function useClickAnchor() {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(false)
  const [point, setPoint] = React.useState({ x: 0, y: 0 })
  const anchor = React.useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: point.x,
          y: point.y,
          width: 1,
          height: 1,
        }),
    }),
    [point]
  )

  const onOpenChange = React.useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen
    setOpen(nextOpen)
  }, [])

  const onTriggerPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (openRef.current) return
    setPoint({ x: e.clientX, y: e.clientY })
  }, [])

  return { anchor, open, onOpenChange, onTriggerPointerDown } as const
}
