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
import { shutdownSignal } from "../runtime/shutdown"

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
  viewerId: string,
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
  eventName: (event: T) => string,
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
  eventName: (event: T) => string,
) {
  if (pending.length === 0) return false
  const batch = pending.splice(0, pending.length)
  await writeEventBatch(writeSSE, batch, eventName)
  return true
}

async function waitForEventsOrHeartbeat(input: {
  sleep: (ms: number) => Promise<void>
  setWake: (wake: (() => void) | null) => void
  signal: AbortSignal
}) {
  if (input.signal.aborted) return
  const heartbeat = input.sleep(HEARTBEAT_MS)
  const nextEvent = new Promise<void>((resolve) => {
    input.setWake(resolve)
  })
  let resolveShutdown: (() => void) | null = null
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve
    input.signal.addEventListener("abort", resolveShutdown, { once: true })
  })
  try {
    await Promise.race([heartbeat, nextEvent, shutdown])
  } finally {
    if (resolveShutdown) {
      input.signal.removeEventListener("abort", resolveShutdown)
    }
    input.setWake(null)
  }
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
  signal: AbortSignal
}) {
  while (!input.stream.aborted && !input.signal.aborted) {
    if (
      await writePendingEvents(
        input.stream.writeSSE.bind(input.stream),
        input.pending,
        input.eventName,
      )
    ) {
      continue
    }

    await waitForEventsOrHeartbeat({
      sleep: input.sleep,
      setWake: input.setWake,
      signal: input.signal,
    })

    if (
      input.pending.length === 0 &&
      !input.stream.aborted &&
      !input.signal.aborted
    ) {
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
      const pending: QueueEvent[] = []
      let wake: (() => void) | null = null
      const wakeOnShutdown = () => wake?.()

      const unsubscribe = subscribeToAuthorQueue(viewerId, (event) => {
        pending.push(event)
        wake?.()
      })
      shutdownSignal.addEventListener("abort", wakeOnShutdown, { once: true })

      stream.onAbort(() => {
        unsubscribe()
        shutdownSignal.removeEventListener("abort", wakeOnShutdown)
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
          writeIdle: () => stream.writeSSE({ event: "heartbeat", data: "" }),
          signal: shutdownSignal,
        })
      } finally {
        shutdownSignal.removeEventListener("abort", wakeOnShutdown)
        unsubscribe()
      }
    })
  },
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
      const pending: NotificationEvent[] = []
      let wake: (() => void) | null = null
      const wakeOnShutdown = () => wake?.()

      const unsubscribe = subscribeToNotifications(viewerId, (event) => {
        pending.push(event)
        wake?.()
      })
      shutdownSignal.addEventListener("abort", wakeOnShutdown, { once: true })

      stream.onAbort(() => {
        unsubscribe()
        shutdownSignal.removeEventListener("abort", wakeOnShutdown)
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
          signal: shutdownSignal,
        })
      } finally {
        shutdownSignal.removeEventListener("abort", wakeOnShutdown)
        unsubscribe()
      }
    })
  },
)
