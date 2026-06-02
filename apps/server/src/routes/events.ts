import { zValidator } from "./validation"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"

import { type QueueEvent, subscribeToAuthorQueue } from "../clips/events"
import { selectQueueRowsForAuthor } from "../clips/queue-select"
import {
  type NotificationEvent,
  subscribeToNotifications,
} from "../notifications/events"
import { listNotifications } from "../notifications"
import { requireSession } from "../auth/require-session"

const HEARTBEAT_MS = 25_000

const NotificationEventsQuery = z.object({
  snapshot: z.enum(["true", "false"]).default("true"),
})

type StreamSleeper = {
  sleep(ms: number): PromiseLike<unknown>
}

function streamSleep(stream: StreamSleeper): (ms: number) => Promise<void> {
  return async (ms) => {
    await stream.sleep(ms)
  }
}

async function writeQueueSnapshot(
  writeSSE: (message: { event: string; data: string }) => Promise<void>,
  viewerId: string
): Promise<void> {
  const snapshot = await selectQueueRowsForAuthor(viewerId)
  await writeSSE({
    event: "snapshot",
    data: JSON.stringify(snapshot),
  })
}

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

async function waitForEventsOrHeartbeat(input: {
  sleep: (ms: number) => Promise<void>
  setWake: (wake: (() => void) | null) => void
}) {
  const heartbeat = input.sleep(HEARTBEAT_MS)
  const nextEvent = new Promise<void>((resolve) => {
    input.setWake(resolve)
  })
  await Promise.race([heartbeat, nextEvent])
  input.setWake(null)
}

async function runPendingEventStream<T>(input: {
  stream: {
    aborted: boolean
    writeSSE: (message: { event: string; data: string }) => Promise<void>
  }
  sleep: (ms: number) => Promise<void>
  pending: T[]
  setWake: (wake: (() => void) | null) => void
  eventName: (event: T) => string
  writeIdle: () => Promise<void>
}) {
  while (!input.stream.aborted) {
    if (
      await writePendingEvents(
        input.stream.writeSSE.bind(input.stream),
        input.pending,
        input.eventName
      )
    ) {
      continue
    }

    await waitForEventsOrHeartbeat({
      sleep: input.sleep,
      setWake: input.setWake,
    })

    if (input.pending.length === 0 && !input.stream.aborted) {
      await input.writeIdle()
    }
  }
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
        await writeQueueSnapshot(stream.writeSSE.bind(stream), viewerId)

        await runPendingEventStream({
          stream,
          sleep: streamSleep(stream),
          pending,
          setWake: (next) => {
            wake = next
          },
          eventName: (event) => event.type,
          writeIdle: () =>
            writeQueueSnapshot(stream.writeSSE.bind(stream), viewerId),
        })
      } finally {
        unsubscribe()
      }
    })
  }
)

eventsRoute.get(
  "/notifications",
  requireSession,
  zValidator("query", NotificationEventsQuery),
  (c) => {
    const viewerId = c.var.viewerId
    const { snapshot } = c.req.valid("query")
    const includeSnapshot = snapshot !== "false"

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

        await runPendingEventStream({
          stream,
          sleep: streamSleep(stream),
          pending,
          setWake: (next) => {
            wake = next
          },
          eventName: (event) => event.type,
          writeIdle: () => stream.writeSSE({ event: "heartbeat", data: "" }),
        })
      } finally {
        unsubscribe()
      }
    })
  }
)
