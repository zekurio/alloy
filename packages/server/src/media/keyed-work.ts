/**
 * A bounded runner for media jobs that requests start directly, such as the
 * poster route's frame grabs. The media worker bounds its own runs with
 * `env.transcode.concurrency`; work a request starts needs a ceiling too, or
 * a burst of requests starts one ffmpeg each.
 *
 * - At most `concurrency` jobs run at once and up to `maxWaiting` more wait.
 *   Beyond that a call fails at once with {@link MediaWorkBusyError}, so no
 *   backlog builds up.
 * - Concurrent calls with one key share a single run and its result.
 * - A caller whose signal aborts stops waiting at once. The run is aborted
 *   when its last caller leaves, so a dropped request stops its ffmpeg unless
 *   another request still wants the same result.
 */

export class MediaWorkBusyError extends Error {
  constructor() {
    super("Too many media jobs are waiting")
    this.name = "MediaWorkBusyError"
  }
}

interface SharedRun<T> {
  controller: AbortController
  callers: number
  result: Promise<T>
}

export interface KeyedWork<T> {
  run(
    key: string,
    signal: AbortSignal,
    job: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>
}

export function createKeyedWork<T>(opts: {
  concurrency: number
  maxWaiting: number
}): KeyedWork<T> {
  const runs = new Map<string, SharedRun<T>>()
  const waiting: Array<() => void> = []
  let running = 0

  const acquire = async (signal: AbortSignal): Promise<void> => {
    if (running < opts.concurrency) {
      running += 1
      return
    }
    if (waiting.length >= opts.maxWaiting) throw new MediaWorkBusyError()
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", cancel)
        resolve()
      }
      const cancel = () => {
        waiting.splice(waiting.indexOf(ready), 1)
        reject(abortError())
      }
      waiting.push(ready)
      signal.addEventListener("abort", cancel, { once: true })
    })
  }

  // A finished job hands its slot straight to the next waiter.
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }

  const start = (
    key: string,
    job: (signal: AbortSignal) => Promise<T>,
  ): SharedRun<T> => {
    const controller = new AbortController()
    const result = (async () => {
      await acquire(controller.signal)
      try {
        controller.signal.throwIfAborted()
        return await job(controller.signal)
      } finally {
        release()
      }
    })()
    const run = { controller, callers: 0, result }
    runs.set(key, run)
    void result
      .catch(() => undefined)
      .finally(() => {
        if (runs.get(key) === run) runs.delete(key)
      })
    return run
  }

  return {
    async run(key, signal, job) {
      if (signal.aborted) throw abortError()
      // A run whose callers have all left is already stopping, and its
      // abort says nothing about the job, so it is not joined.
      const existing = runs.get(key)
      const run =
        existing && !existing.controller.signal.aborted
          ? existing
          : start(key, job)
      run.callers += 1
      try {
        return await untilAborted(run.result, signal)
      } finally {
        run.callers -= 1
        if (run.callers === 0) run.controller.abort()
      }
    },
  }
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener("abort", onAbort, { once: true })
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort))
  })
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError")
}
