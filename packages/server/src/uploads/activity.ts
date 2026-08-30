type GateMode = "activity" | "stopped"

interface GateWaiter {
  mode: GateMode
  resolve: (release: () => void) => void
}

interface GateState {
  readers: number
  writer: boolean
  waiters: GateWaiter[]
}

/**
 * Fair, single-process keyed read/write gate. Upload requests share the active
 * side; ownership removal takes the stopped side, waits for every in-flight
 * writer to drain, and prevents a late request from recreating deleted bytes.
 */
export class UploadActivityGate {
  readonly #states = new Map<string, GateState>()

  async withActivity<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.#withGate(key, "activity", operation)
  }

  async withStopped<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.#withGate(key, "stopped", operation)
  }

  async #withGate<T>(
    rawKey: string,
    mode: GateMode,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = rawKey.toLowerCase()
    const release = await this.#acquire(key, mode)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  #acquire(key: string, mode: GateMode): Promise<() => void> {
    const state = this.#states.get(key) ?? {
      readers: 0,
      writer: false,
      waiters: [],
    }
    this.#states.set(key, state)

    if (this.#canEnterImmediately(state, mode)) {
      return Promise.resolve(this.#enter(key, state, mode))
    }
    return new Promise((resolve) => state.waiters.push({ mode, resolve }))
  }

  #canEnterImmediately(state: GateState, mode: GateMode): boolean {
    if (state.writer || state.waiters.length > 0) return false
    return mode === "activity" || state.readers === 0
  }

  #enter(key: string, state: GateState, mode: GateMode): () => void {
    if (mode === "activity") state.readers += 1
    else state.writer = true

    let released = false
    return () => {
      if (released) return
      released = true
      if (mode === "activity") state.readers -= 1
      else state.writer = false
      this.#drain(key, state)
    }
  }

  #drain(key: string, state: GateState): void {
    if (state.writer || state.readers > 0) return
    const first = state.waiters[0]
    if (!first) {
      this.#states.delete(key)
      return
    }

    if (first.mode === "stopped") {
      state.waiters.shift()
      first.resolve(this.#enter(key, state, "stopped"))
      return
    }

    while (state.waiters[0]?.mode === "activity" && !state.writer) {
      const waiter = state.waiters.shift()
      if (!waiter) break
      waiter.resolve(this.#enter(key, state, "activity"))
    }
  }
}

const uploadActivity = new UploadActivityGate()

export function withUploadActivity<T>(
  clipId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return uploadActivity.withActivity(clipId, operation)
}

export function withUploadActivityStopped<T>(
  clipId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return uploadActivity.withStopped(clipId, operation)
}
