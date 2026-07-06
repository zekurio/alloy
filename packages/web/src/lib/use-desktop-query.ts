import { useCallback, useEffect, useState } from "react"
import type { DependencyList, Dispatch, SetStateAction } from "react"

/**
 * Loads a value from a desktop-bridge (IPC) call on mount and whenever `deps`
 * change, dropping stale results so a fast remount can't clobber fresh state.
 * Desktop IPC lives outside TanStack Query, so this replaces the hand-rolled
 * "fetch + cancelled flag" effect each desktop panel used to repeat.
 *
 * Pass `load: null` when the bridge is unavailable (plain web) — the hook stays
 * idle with `data` undefined. `setData` applies the result of a follow-up
 * mutation without a refetch; `refetch` re-runs the loader on demand.
 */
export function useDesktopQuery<T>(
  load: (() => Promise<T>) | null | undefined,
  deps: DependencyList,
): {
  data: T | undefined
  setData: Dispatch<SetStateAction<T | undefined>>
  loading: boolean
  refetch: () => void
} {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(load != null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const refetch = useCallback(() => setReloadNonce((nonce) => nonce + 1), [])

  useEffect(() => {
    if (load == null) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void load()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [...deps, reloadNonce])

  return { data, setData, loading, refetch }
}
