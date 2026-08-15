import { instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"

import type { JobTransaction } from "../store"

type StorageMaintenanceSummary = (typeof instanceSetting.$inferInsert)["value"]

export async function writeStorageMaintenanceSummary(
  key: string,
  value: StorageMaintenanceSummary,
  tx?: JobTransaction,
): Promise<void> {
  await (tx ?? db)
    .insert(instanceSetting)
    .values({ key, value, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value, updated_at: new Date() },
    })
}
