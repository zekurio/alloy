interface BackgroundMediaWork {
  run: (signal: AbortSignal) => Promise<void>
  reject: (cause: unknown) => void
  finish: () => void
}

export class BackgroundMediaWorkCache<Result> {
  readonly pending = new Map<string, Promise<Result>>()
}

const queue: BackgroundMediaWork[] = []
let foregroundPlaybackCount = 0
let activeController: AbortController | null = null
let running = false

/**
 * Runs expensive detached-video decoding one job at a time. Starting visible
 * playback aborts the current job and retries it after every player pauses.
 *
 * An aborted job is re-invoked through the same `run` reference, so `run` must
 * be resumable: park partial results in the closure rather than recomputing
 * them, or repeated play/pause will starve the job forever.
 */
export function scheduleBackgroundMediaWork<T>(
  cache: BackgroundMediaWorkCache<T>,
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const existing = cache.pending.get(key)
  if (existing) return existing

  const pending = new Promise<T>((resolve, reject) => {
    queue.push({
      run: async (signal) => resolve(await run(signal)),
      reject,
      finish: () => cache.pending.delete(key),
    })
  })
  cache.pending.set(key, pending)
  pumpBackgroundMediaWork()
  return pending
}

/** Suspends detached-video work until the returned release function runs. */
export function suspendBackgroundMediaWork(): () => void {
  foregroundPlaybackCount += 1
  activeController?.abort()
  let released = false
  return () => {
    if (released) return
    released = true
    foregroundPlaybackCount = Math.max(0, foregroundPlaybackCount - 1)
    pumpBackgroundMediaWork()
  }
}

function pumpBackgroundMediaWork(): void {
  if (running || foregroundPlaybackCount > 0 || queue.length === 0) return
  running = true
  const work = queue.shift()
  if (!work) {
    running = false
    return
  }
  activeController = new AbortController()
  void work
    .run(activeController.signal)
    .then(work.finish)
    .catch((cause: unknown) => {
      if (activeController?.signal.aborted) {
        queue.unshift(work)
        return
      }
      work.finish()
      work.reject(cause)
    })
    .finally(() => {
      activeController = null
      running = false
      pumpBackgroundMediaWork()
    })
}
