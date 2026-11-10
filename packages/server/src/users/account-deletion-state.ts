interface ActivityState {
  count: number
  drained: Set<() => void>
}

type InactiveAccountDeletionResult<T> = { ok: true; value: T } | { ok: false }

/**
 * Single-process account deletion coordination, keyed by user id as the
 * database returns it or a validated request carries it (lowercase).
 * Concurrent delete requests share one result, while short reactivation mutations either finish before
 * deletion starts or are rejected for the lifetime of the deletion promise.
 */
class AccountDeletionState {
  readonly #active = new Map<string, Promise<unknown>>()
  readonly #activities = new Map<string, ActivityState>()

  run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    // SAFETY: All callers for one identity share the single account-deletion
    // operation and therefore its result type.
    const existing = this.#active.get(userId) as Promise<T> | undefined
    if (existing) return existing

    const pending = Promise.resolve().then(async () => {
      await this.#waitForActivities(userId)
      return operation()
    })
    this.#active.set(userId, pending)
    const cleanup = () => {
      if (this.#active.get(userId) === pending) this.#active.delete(userId)
    }
    void pending.then(cleanup, cleanup)
    return pending
  }

  async withInactive<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<InactiveAccountDeletionResult<T>> {
    if (this.#active.has(userId)) return { ok: false }

    const state = this.#activities.get(userId) ?? {
      count: 0,
      drained: new Set(),
    }
    this.#activities.set(userId, state)
    state.count += 1
    try {
      return { ok: true, value: await operation() }
    } finally {
      state.count -= 1
      if (state.count === 0) {
        for (const resolve of state.drained) resolve()
        this.#activities.delete(userId)
      }
    }
  }

  async #waitForActivities(userId: string): Promise<void> {
    const state = this.#activities.get(userId)
    if (!state || state.count === 0) return
    await new Promise<void>((resolve) => state.drained.add(resolve))
  }
}

export const accountDeletionState = new AccountDeletionState()
