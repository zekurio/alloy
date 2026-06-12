import type { DesktopUpdateState } from "@alloy/contracts"
import * as React from "react"

import { alloyDesktop } from "@/lib/desktop"

const IDLE_STATE: DesktopUpdateState = { status: "idle", version: null }

/**
 * Auto-update state of the desktop shell hosting this page. Always "idle" in
 * a regular browser or on desktop shells that predate the updates bridge, so
 * update UI renders nothing outside the desktop app.
 */
export function useDesktopUpdateState(): DesktopUpdateState {
  const updates = alloyDesktop()?.updates
  const [state, setState] = React.useState<DesktopUpdateState>(IDLE_STATE)

  React.useEffect(() => {
    if (!updates) return
    let disposed = false
    void updates
      .getState()
      .then((initial) => {
        if (!disposed) setState(initial)
      })
      .catch(() => {
        // Bridge unavailable; stay idle.
      })
    const unsubscribe = updates.onState((next) => {
      if (!disposed) setState(next)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [updates])

  return updates ? state : IDLE_STATE
}
