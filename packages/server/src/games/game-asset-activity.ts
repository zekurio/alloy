interface GateState {
  locked: boolean
  waiters: Array<() => void>
}

/** Fair per-game mutex. Alloy intentionally runs one server process. */
export class GameAssetMutationGate {
  readonly #states = new Map<string, GateState>()

  async run<T>(gameId: string, operation: () => Promise<T>): Promise<T> {
    const key = gameId.toLowerCase()
    const release = await this.#acquire(key)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  #acquire(key: string): Promise<() => void> {
    const state = this.#states.get(key) ?? { locked: false, waiters: [] }
    this.#states.set(key, state)
    if (!state.locked) {
      state.locked = true
      return Promise.resolve(this.#release(key, state))
    }
    return new Promise((resolve) =>
      state.waiters.push(() => resolve(this.#release(key, state))),
    )
  }

  #release(key: string, state: GateState): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = state.waiters.shift()
      if (next) next()
      else {
        state.locked = false
        this.#states.delete(key)
      }
    }
  }
}

const gameAssetMutations = new GameAssetMutationGate()

export function withGameAssetMutation<T>(
  gameId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return gameAssetMutations.run(gameId, operation)
}
