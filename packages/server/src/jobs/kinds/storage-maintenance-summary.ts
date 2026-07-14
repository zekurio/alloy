import { instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"

export async function writeStorageMaintenanceSummary(
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(instanceSetting)
    .values({ key, value, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value, updated_at: new Date() },
    })
}
