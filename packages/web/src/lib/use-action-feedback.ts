import { useCallback, useEffect, useRef, useState } from "react"

import { errorMessage } from "./error-message"

type ActionFeedback =
  | { state: "idle" | "pending" | "success" }
  | { state: "error"; message: string }

export function useActionFeedback(successDuration = 1400) {
  const [feedback, setFeedback] = useState<ActionFeedback>({ state: "idle" })
  const resetTimer = useRef<number | null>(null)

  const reset = useCallback(() => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = null
    setFeedback({ state: "idle" })
  }, [])

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  const run = useCallback(
    async (action: () => void | Promise<void>, fallbackError: string) => {
      reset()
      setFeedback({ state: "pending" })
      try {
        await action()
        setFeedback({ state: "success" })
        resetTimer.current = window.setTimeout(reset, successDuration)
        return true
      } catch (cause) {
        setFeedback({
          state: "error",
          message: errorMessage(cause, fallbackError),
        })
        return false
      }
    },
    [reset, successDuration],
  )

  return { feedback, reset, run }
}

export type { ActionFeedback }
