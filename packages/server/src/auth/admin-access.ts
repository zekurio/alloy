import { locks } from "node:worker_threads"

import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { sql } from "drizzle-orm"

const ADMIN_ACCESS_ADVISORY_LOCK = sql`select pg_advisory_xact_lock(hashtext('alloy:admin-access'))`

export function withAdminAccessChange<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return locks.request("alloy:admin-access", operation)
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
