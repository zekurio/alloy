import * as React from "react"

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

/**
 * Undo/redo history over an immutable editor state. Discrete operations
 * (split, delete, add) go through `apply`; continuous interactions (drags,
 * trims) bracket their live `update` calls with `beginEdit` / `commitEdit`
 * so a whole drag collapses into one undo step.
 */
export function useEditorHistory<T>(
  initial: T,
  isEqual: (a: T, b: T) => boolean,
) {
  const [state, setState] = React.useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  })
  const presentRef = React.useRef(state.present)
  presentRef.current = state.present
  const pendingRef = React.useRef<T | null>(null)
  const isEqualRef = React.useRef(isEqual)
  isEqualRef.current = isEqual

  const apply = React.useCallback((next: T) => {
    setState((current) =>
      isEqualRef.current(current.present, next)
        ? current
        : {
            past: [...current.past, current.present],
            present: next,
            future: [],
          },
    )
  }, [])

  const update = React.useCallback((next: T) => {
    setState((current) => ({ ...current, present: next }))
  }, [])

  const reset = React.useCallback((next: T) => {
    pendingRef.current = null
    setState({ past: [], present: next, future: [] })
  }, [])

  const beginEdit = React.useCallback(() => {
    pendingRef.current ??= presentRef.current
  }, [])

  const commitEdit = React.useCallback(() => {
    const snapshot = pendingRef.current
    pendingRef.current = null
    if (snapshot === null) return
    setState((current) =>
      isEqualRef.current(snapshot, current.present)
        ? current
        : {
            past: [...current.past, snapshot],
            present: current.present,
            future: [],
          },
    )
  }, [])

  const undo = React.useCallback(() => {
    setState((current) => {
      if (current.past.length === 0) return current
      const previous = current.past[current.past.length - 1]
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      }
    })
  }, [])

  const redo = React.useCallback(() => {
    setState((current) => {
      if (current.future.length === 0) return current
      const [next, ...rest] = current.future
      return {
        past: [...current.past, current.present],
        present: next,
        future: rest,
      }
    })
  }, [])

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    update,
    reset,
    beginEdit,
    commitEdit,
    undo,
    redo,
  }
}
