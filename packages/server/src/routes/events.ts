import { createLogger } from "@alloy/logging"
import { isSessionActive, requireSession } from "@alloy/server/auth/session"
import {
  type QueueEvent,
  subscribeToAuthorQueue,
} from "@alloy/server/clips/events"
import { selectQueueRowsForAuthor } from "@alloy/server/clips/queue-select"
import { shutdownSignal } from "@alloy/server/runtime/shutdown"
import { Hono } from "hono"
import { type SSEStreamingApi, streamSSE } from "hono/streaming"

const HEARTBEAT_MS = 25_000

const logger = createLogger("events")

type StreamSleeper = Pick<SSEStreamingApi, "sleep">

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
  /** Returns false to end the stream. */
  stillAuthorized: () => Promise<boolean>
  signal: AbortSignal
}) {
  while (!input.stream.aborted && !input.signal.aborted) {
    if (!(await input.stillAuthorized())) return

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

async function runHeartbeatEventStream<T>(input: {
  stream: Pick<SSEStreamingApi, "aborted" | "sleep" | "writeSSE">
  pending: T[]
  setWake: (wake: (() => void) | null) => void
  eventName: (event: T) => string
  sessionId: string
}) {
  await runPendingEventStream({
    ...input,
    sleep: streamSleep(input.stream),
    writeIdle: () => input.stream.writeSSE({ event: "heartbeat", data: "" }),
    stillAuthorized: sessionCheck(input.sessionId),
    signal: shutdownSignal,
  })
}

async function streamSubscribedEvents<T>(input: {
  stream: Pick<SSEStreamingApi, "aborted" | "sleep" | "onAbort" | "writeSSE">
  pending: T[]
  subscribe: (push: (event: T) => void) => () => void
  writeSnapshot: () => Promise<void>
  eventName: (event: T) => string
  sessionId: string
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
      sessionId: input.sessionId,
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
    const sessionId = c.var.session.session.id

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
        sessionId,
      })
    })
  },
)
