import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import { subscribeToAuthorQueue, type QueueEvent } from "../lib/clip-events"
import { selectQueueRowsForAuthor } from "../lib/clip-queue-select"
import {
  subscribeToNotifications,
  type NotificationEvent,
} from "../lib/notification-events"
import { listNotifications } from "../lib/notifications"
import { requireSession } from "../lib/require-session"

const HEARTBEAT_MS = 25_000

async function writeEventBatch<T>(
  writeSSE: (message: { event: string; data: string }) => Promise<void>,
  batch: T[],
  eventName: (event: T) => string
) {
  for (const event of batch) {
    await writeSSE({
      event: eventName(event),
      data: JSON.stringify(event),
    })
  }
}

async function writePendingEvents<T>(
  writeSSE: (message: { event: string; data: string }) => Promise<void>,
  pending: T[],
  eventName: (event: T) => string
) {
  if (pending.length === 0) return false
  const batch = pending.splice(0, pending.length)
  await writeEventBatch(writeSSE, batch, eventName)
  return true
}

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
          if (
            await writePendingEvents(
              stream.writeSSE.bind(stream),
              pending,
              (event) => event.type
            )
          )
            continue

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

eventsRoute.get("/notifications", requireSession, (c) => {
  const viewerId = c.var.viewerId
  const includeSnapshot = c.req.query("snapshot") !== "false"

  c.header("Cache-Control", "no-cache, no-transform")
  c.header("X-Accel-Buffering", "no")
  c.header("Content-Encoding", "identity")

  return streamSSE(c, async (stream) => {
    let pending: NotificationEvent[] = []
    let wake: (() => void) | null = null

    const unsubscribe = subscribeToNotifications(viewerId, (event) => {
      pending.push(event)
      wake?.()
    })

    stream.onAbort(() => {
      unsubscribe()
      wake?.()
    })

    try {
      if (includeSnapshot) {
        const snapshot = await listNotifications(viewerId)
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify({ type: "snapshot", payload: snapshot }),
        })
      }

      while (!stream.aborted) {
        if (
          await writePendingEvents(
            stream.writeSSE.bind(stream),
            pending,
            (event) => event.type
          )
        )
          continue

        const heartbeat = stream.sleep(HEARTBEAT_MS)
        const nextEvent = new Promise<void>((resolve) => {
          wake = resolve
        })
        await Promise.race([heartbeat, nextEvent])
        wake = null

        if (pending.length === 0 && !stream.aborted) {
          await stream.writeSSE({ event: "heartbeat", data: "" })
        }
      }
    } finally {
      unsubscribe()
    }
  })
})
