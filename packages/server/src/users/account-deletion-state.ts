interface ActivityState {
  count: number
  drained: Set<() => void>
}

export type InactiveAccountDeletionResult<T> =
  | { ok: true; value: T }
  | { ok: false }

/**
 * Single-process account deletion coordination. Concurrent delete requests
 * share one result, while short reactivation mutations either finish before
 * deletion starts or are rejected for the lifetime of the deletion promise.
 */
export class AccountDeletionState {
  readonly #active = new Map<string, Promise<unknown>>()
  readonly #activities = new Map<string, ActivityState>()

  isActive(userId: string): boolean {
    return this.#active.has(identity(userId))
  }

  run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const key = identity(userId)
    // SAFETY: All callers for one identity share the single account-deletion
    // operation and therefore its result type.
    const existing = this.#active.get(key) as Promise<T> | undefined
    if (existing) return existing

    const pending = Promise.resolve().then(async () => {
      await this.#waitForActivities(key)
      return operation()
    })
    this.#active.set(key, pending)
    const cleanup = () => {
      if (this.#active.get(key) === pending) this.#active.delete(key)
    }
    void pending.then(cleanup, cleanup)
    return pending
  }

  async withInactive<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<InactiveAccountDeletionResult<T>> {
    const key = identity(userId)
    if (this.#active.has(key)) return { ok: false }

    const state = this.#activities.get(key) ?? {
      count: 0,
      drained: new Set(),
    }
    this.#activities.set(key, state)
    state.count += 1
    try {
      return { ok: true, value: await operation() }
    } finally {
      state.count -= 1
      if (state.count === 0) {
        for (const resolve of state.drained) resolve()
        this.#activities.delete(key)
      }
    }
  }

  async #waitForActivities(key: string): Promise<void> {
    const state = this.#activities.get(key)
    if (!state || state.count === 0) return
    await new Promise<void>((resolve) => state.drained.add(resolve))
  }
}

export const accountDeletionState = new AccountDeletionState()

function identity(userId: string): string {
  return userId.toLowerCase()
}
