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

  // Returning false means the action was cancelled and should return to idle
  // without displaying either success or error feedback.
  const run = useCallback(
    async (
      action: () => boolean | void | Promise<boolean | void>,
      fallbackError: string,
    ) => {
      reset()
      setFeedback({ state: "pending" })
      try {
        const completed = await action()
        if (completed === false) {
          reset()
          return false
        }
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
