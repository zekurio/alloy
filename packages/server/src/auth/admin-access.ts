import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { sql } from "drizzle-orm"

const ADMIN_ACCESS_ADVISORY_LOCK = sql`select pg_advisory_xact_lock(hashtext('alloy:admin-access'))`

/** Fair single-process mutex for admin access and auth-config transitions. */
export class AdminAccessChangeMutex {
  #locked = false
  readonly #waiters: Array<() => void> = []

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire()
    try {
      return await operation()
    } finally {
      this.#release()
    }
  }

  #acquire(): Promise<void> {
    if (!this.#locked) {
      this.#locked = true
      return Promise.resolve()
    }
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  #release(): void {
    const next = this.#waiters.shift()
    if (next) next()
    else this.#locked = false
  }
}

const adminAccessChanges = new AdminAccessChangeMutex()

export function withAdminAccessChange<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return adminAccessChanges.run(operation)
}

export async function lockAdminAccessInvariant(
  tx: DbTransaction,
): Promise<void> {
  await tx.execute(ADMIN_ACCESS_ADVISORY_LOCK)
}

export function withAdminAccessInvariant<T>(
  operation: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withAdminAccessChange(() =>
    db.transaction(async (tx) => {
      await lockAdminAccessInvariant(tx)
      return operation(tx)
    }),
  )
}
