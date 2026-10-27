import { useState } from "react"

type ActiveOption = {
  options: readonly unknown[]
  index: number
  navigated: boolean
}

/**
 * Highlighted option for a suggestion list. The highlight returns to the top
 * whenever the options change identity; `navigated` records whether the user
 * has moved it with the arrow keys since then.
 */
export function useActiveOption(options: readonly unknown[]) {
  const [state, setState] = useState<ActiveOption>(() => ({
    options,
    index: 0,
    navigated: false,
  }))
  let current = state
  if (state.options !== options) {
    current = { options, index: 0, navigated: false }
    setState(current)
  }

  const move = (step: 1 | -1) => {
    if (options.length === 0) return
    setState((prev) => {
      const index = prev.options === options ? prev.index : 0
      return {
        options,
        index: (index + step + options.length) % options.length,
        navigated: true,
      }
    })
  }

  const highlight = (index: number) => {
    setState((prev) => ({
      options,
      index,
      navigated: prev.options === options && prev.navigated,
    }))
  }

  return {
    activeIndex: current.index,
    navigated: current.navigated,
    move,
    highlight,
  }
}
