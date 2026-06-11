import { requireSession } from "@alloy/server/auth/require-session"
import {
  type QueueEvent,
  subscribeToAuthorQueue,
} from "@alloy/server/clips/events"
import { selectQueueRowsForAuthor } from "@alloy/server/clips/queue-select"
import {
  type NotificationEvent,
  subscribeToNotifications,
} from "@alloy/server/notifications/events"
import { listNotifications } from "@alloy/server/notifications/index"
import { shutdownSignal } from "@alloy/server/runtime/shutdown"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"

import { zValidator } from "./validation"

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

async function runHeartbeatEventStream<T>(input: {
  stream: {
    aborted: boolean
    sleep(ms: number): PromiseLike<unknown>
    writeSSE: (message: { event: string; data: string }) => Promise<void>
  }
  pending: T[]
  setWake: (wake: (() => void) | null) => void
  eventName: (event: T) => string
}) {
  await runPendingEventStream({
    ...input,
    sleep: streamSleep(input.stream),
    writeIdle: () => input.stream.writeSSE({ event: "heartbeat", data: "" }),
    signal: shutdownSignal,
  })
}

async function streamSubscribedEvents<T>(input: {
  stream: {
    aborted: boolean
    sleep(ms: number): PromiseLike<unknown>
    onAbort(callback: () => void): void
    writeSSE: (message: { event: string; data: string }) => Promise<void>
  }
  pending: T[]
  subscribe: (push: (event: T) => void) => () => void
  writeSnapshot: () => Promise<void>
  eventName: (event: T) => string
}) {
  let wake: (() => void) | null = null
  const wakeOnShutdown = () => wake?.()
  const unsubscribe = input.subscribe((event) => {
    input.pending.push(event)
    wake?.()
  })
  shutdownSignal.addEventListener("abort", wakeOnShutdown, { once: true })

  input.stream.onAbort(() => {
    unsubscribe()
    shutdownSignal.removeEventListener("abort", wakeOnShutdown)
    wake?.()
  })

  try {
    await input.writeSnapshot()
    await runHeartbeatEventStream({
      stream: input.stream,
      pending: input.pending,
      setWake: (next) => {
        wake = next
      },
      eventName: input.eventName,
    })
  } finally {
    shutdownSignal.removeEventListener("abort", wakeOnShutdown)
    unsubscribe()
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
      await streamSubscribedEvents({
        stream,
        pending,
        subscribe: (push) => subscribeToAuthorQueue(viewerId, push),
        writeSnapshot: () =>
          writeQueueSnapshot(stream.writeSSE.bind(stream), viewerId),
        eventName: (event) => event.type,
      })
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
      await streamSubscribedEvents({
        stream,
        pending,
        subscribe: (push) => subscribeToNotifications(viewerId, push),
        writeSnapshot: async () => {
          if (includeSnapshot) {
            const snapshot = await listNotifications(viewerId)
            await stream.writeSSE({
              event: "snapshot",
              data: JSON.stringify({ type: "snapshot", payload: snapshot }),
            })
          }
        },
        eventName: (event) => event.type,
      })
    })
  },
)
