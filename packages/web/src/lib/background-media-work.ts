interface BackgroundMediaWork<T> {
  key: string
  run: (signal: AbortSignal) => Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

const pendingByKey = new Map<string, Promise<unknown>>()
const queue: BackgroundMediaWork<unknown>[] = []
let foregroundPlaybackCount = 0
let activeController: AbortController | null = null
let running = false

/**
 * Runs expensive detached-video decoding one job at a time. Starting visible
 * playback aborts the current job and retries it after every player pauses.
 */
export function scheduleBackgroundMediaWork<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const existing = pendingByKey.get(key)
  if (existing) return existing as Promise<T>

  const pending = new Promise<T>((resolve, reject) => {
    queue.push({
      key,
      run,
      resolve,
      reject,
    } as BackgroundMediaWork<unknown>)
  })
  pendingByKey.set(key, pending)
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
    .then((result) => {
      pendingByKey.delete(work.key)
      work.resolve(result)
    })
    .catch((cause: unknown) => {
      if (activeController?.signal.aborted) {
        queue.unshift(work)
        return
      }
      pendingByKey.delete(work.key)
      work.reject(cause)
    })
    .finally(() => {
      activeController = null
      running = false
      pumpBackgroundMediaWork()
    })
}
