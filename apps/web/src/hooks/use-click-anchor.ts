import * as React from "react"

export function useClickAnchor() {
  const [anchor, setAnchor] = React.useState<{
    getBoundingClientRect: () => DOMRect
  } | null>(null)

  const onTriggerClick = React.useCallback((e: React.MouseEvent) => {
    const x = e.clientX
    const y = e.clientY
    setAnchor({
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    })
  }, [])

  return { anchor, onTriggerClick } as const
}
