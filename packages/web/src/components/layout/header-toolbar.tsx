import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { FunnelIcon } from "lucide-react"
import * as React from "react"

import { toolbarIconButtonClass } from "@/components/clip/sort-dropdown"

type HeaderToolbarNode =
  | React.ReactNode
  | {
      desktop: React.ReactNode
      mobile: React.ReactNode
    }

/**
 * Lets the active route publish a controls node (filter/sort) into the global
 * app header, since pages render under `<Outlet/>` and cannot reach the header
 * that is mounted once in the `_app` layout.
 */
type HeaderToolbarContextValue = {
  node: HeaderToolbarNode
  setNode: (node: HeaderToolbarNode) => void
}

const HeaderToolbarContext =
  React.createContext<HeaderToolbarContextValue | null>(null)

export function HeaderToolbarProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [node, setNode] = React.useState<HeaderToolbarNode>(null)
  const setToolbarNode = React.useCallback((next: HeaderToolbarNode) => {
    setNode(next)
  }, [])
  const value = React.useMemo(
    () => ({ node, setNode: setToolbarNode }),
    [node, setToolbarNode],
  )
  return (
    <HeaderToolbarContext.Provider value={value}>
      {children}
    </HeaderToolbarContext.Provider>
  )
}

function useHeaderToolbarContext(): HeaderToolbarContextValue {
  const value = React.useContext(HeaderToolbarContext)
  if (!value) {
    throw new Error(
      "useHeaderToolbar must be used within a HeaderToolbarProvider",
    )
  }
  return value
}

/**
 * Register the controls for the current route. Pass a memoized `node` so the
 * effect only re-runs when the controls actually change; the slot is cleared
 * automatically when the route unmounts.
 */
export function useHeaderToolbar(node: HeaderToolbarNode): void {
  const { setNode } = useHeaderToolbarContext()
  React.useLayoutEffect(() => {
    setNode(node)
    return () => setNode(null)
  }, [node, setNode])
}

/**
 * Renders the active route's controls inside the header. Inline on `md+`; on
 * mobile the header row is too tight, so the controls collapse behind a single
 * filter button that opens a popover.
 */
export function HeaderToolbarSlot() {
  const { node } = useHeaderToolbarContext()
  if (!node) return null

  if (isResponsiveToolbarNode(node)) {
    return (
      <>
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          {node.desktop}
        </div>
        <div className="flex items-center gap-1.5 md:hidden">{node.mobile}</div>
      </>
    )
  }

  return (
    <>
      <div className="hidden min-w-0 items-center gap-2 md:flex">{node}</div>
      <div className="md:hidden">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="secondary"
                size="icon"
                className={toolbarIconButtonClass}
                aria-label={tx("Filters")}
              />
            }
          >
            <FunnelIcon />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto">
            <div className="flex flex-col gap-2">{node}</div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

function isResponsiveToolbarNode(
  node: HeaderToolbarNode,
): node is { desktop: React.ReactNode; mobile: React.ReactNode } {
  return (
    typeof node === "object" &&
    node !== null &&
    "desktop" in node &&
    "mobile" in node
  )
}
