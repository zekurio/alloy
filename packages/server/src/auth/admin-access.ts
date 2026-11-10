import { locks } from "node:worker_threads"

import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"

/**
 * Serialises every change that can take away the last admin's access or
 * create the first admin: role and status changes, removing a sign-in
 * method, sign-in config saves, and first-admin setup. The server is a single
 * process, so an in-process lock covers them all. It is not reentrant: code
 * holding it must not call anything that takes it again.
 */
export function withAdminAccessChange<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return locks.request("alloy:admin-access", operation)
}

/** Runs `operation` in a transaction under the admin access lock. */
export function withAdminAccessInvariant<T>(
  operation: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withAdminAccessChange(() => db.transaction(operation))
}
