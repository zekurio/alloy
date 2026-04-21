import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import {
  subscribeToAuthorQueue,
  type QueueEvent,
} from "../lib/clip-events"
import { selectQueueRowsForAuthor } from "../lib/clip-queue-select"
import { requireSession } from "../lib/require-session"

const HEARTBEAT_MS = 25_000

export const eventsRoute = new Hono().get(
  "/clips/queue",
  requireSession,
  (c) => {
    const viewerId = c.var.viewerId

    c.header("Cache-Control", "no-cache, no-transform")
    c.header("X-Accel-Buffering", "no")
    c.header("Content-Encoding", "identity")

    return streamSSE(c, async (stream) => {
      let pending: QueueEvent[] = []
      let wake: (() => void) | null = null

      const unsubscribe = subscribeToAuthorQueue(viewerId, (event) => {
        pending.push(event)
        wake?.()
      })

      stream.onAbort(() => {
        unsubscribe()
        wake?.()
      })

      try {
        const snapshot = await selectQueueRowsForAuthor(viewerId)
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify(snapshot),
        })

        while (!stream.aborted) {
          if (pending.length > 0) {
            const batch = pending
            pending = []
            for (const event of batch) {
              await stream.writeSSE({
                event: event.type,
                data: JSON.stringify(event),
              })
            }
            continue
          }

          // Idle: race the heartbeat against the next publish.
          const heartbeat = stream.sleep(HEARTBEAT_MS)
          const nextEvent = new Promise<void>((resolve) => {
            wake = resolve
          })
          await Promise.race([heartbeat, nextEvent])
          wake = null

          if (pending.length === 0 && !stream.aborted) {
            // Heartbeat tick — zero-payload event the client ignores.
            // Keeps the pipe warm for proxies with idle timeouts.
            await stream.writeSSE({ event: "heartbeat", data: "" })
          }
        }
      } finally {
        unsubscribe()
      }
    })
  }
)
