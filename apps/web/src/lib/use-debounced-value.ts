import * as React from "react"

/**
 * Debounce a rapidly changing value for use as a cache key or network
 * query input. The returned value lags the input by `delayMs`,
 * resetting its timer on each change — settle for at least `delayMs`
 * to see the result propagate.
 *
 * Kept deliberately minimal: no leading/trailing flag, no cancel API.
 * If a call site needs richer control (e.g. flushing on blur), reach
 * for `setTimeout` directly rather than bolting knobs onto this hook.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}
