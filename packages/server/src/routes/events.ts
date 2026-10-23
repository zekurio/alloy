import { createLogger } from "@alloy/logging"
import { isSessionActive, requireSession } from "@alloy/server/auth/session"
import {
  type QueueEvent,
  subscribeToAuthorQueue,
} from "@alloy/server/clips/events"
import { selectQueueRowsForAuthor } from "@alloy/server/clips/queue-select"
import { shutdownSignal } from "@alloy/server/runtime/shutdown"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

const HEARTBEAT_MS = 25_000

const logger = createLogger("events")

/**
 * The stream authenticates only when it opens. Look the session up again once
 * per heartbeat interval, busy or idle, so a revoked or expired session stops
 * receiving events. Ending the stream makes the client reconnect, and that
 * request gets a 401.
 */
function sessionCheck(sessionId: string): () => Promise<boolean> {
  let checkedAt = Date.now()
  return async () => {
    if (Date.now() - checkedAt < HEARTBEAT_MS) return true
    checkedAt = Date.now()
    try {
      return await isSessionActive(sessionId)
    } catch (cause) {
      // Ending the stream is safe: the reconnect authenticates from scratch.
      logger.warn("event stream session check failed:", cause)
      return false
    }
  }
}

/**
 * Resolves after `ms`, or as soon as the callback handed to `setWake` runs.
 * Either way the timer is cleared, so events leave no timers behind.
 */
function sleepUntilWoken(
  ms: number,
  setWake: (wake: (() => void) | null) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer)
      setWake(null)
      resolve()
    }
    const timer = setTimeout(wake, ms)
    setWake(wake)
  })
}

export const eventsRoute = new Hono().get(
  "/clips/queue",
  requireSession,
  (c) => {
    const viewerId = c.var.viewerId
    const stillAuthorized = sessionCheck(c.var.session.session.id)

    c.header("Cache-Control", "no-cache, no-transform")
    c.header("X-Accel-Buffering", "no")
    c.header("Content-Encoding", "identity")

    return streamSSE(c, async (stream) => {
      const pending: QueueEvent[] = []
      let wake: (() => void) | null = null
      const wakeNow = () => wake?.()
      const isOpen = () => !stream.aborted && !shutdownSignal.aborted

      const unsubscribe = subscribeToAuthorQueue(viewerId, (event) => {
        pending.push(event)
        wakeNow()
      })
      shutdownSignal.addEventListener("abort", wakeNow)
      stream.onAbort(wakeNow)

      try {
        const snapshot = await selectQueueRowsForAuthor(viewerId)
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify(snapshot),
        })

        while (isOpen() && (await stillAuthorized())) {
          if (pending.length > 0) {
            for (const event of pending.splice(0)) {
              await stream.writeSSE({
                event: event.type,
                data: JSON.stringify(event),
              })
            }
            continue
          }

          // The session check above awaited; an abort or shutdown that landed
          // during it found no wake installed, so look again before sleeping.
          if (!isOpen()) break
          await sleepUntilWoken(HEARTBEAT_MS, (next) => {
            wake = next
          })
          if (pending.length === 0 && isOpen()) {
            await stream.writeSSE({ event: "heartbeat", data: "" })
          }
        }
      } finally {
        shutdownSignal.removeEventListener("abort", wakeNow)
        unsubscribe()
      }
    })
  },
)
