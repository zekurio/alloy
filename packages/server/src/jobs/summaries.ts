import {
  AdminRenditionSweepSummarySchema,
  AdminStorageGcSummarySchema,
  type AdminRenditionSweepSummary,
  type AdminStorageGcSummary,
} from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { inArray } from "drizzle-orm"
import type { TSchema } from "typebox"

// Instance-setting keys the sweep handlers write their last-run summaries to.
const RENDITION_SWEEP_KEY = "renditionSweep"
const STORAGE_GC_KEY = "storageGc"
type StoredSummaryValue = (typeof instanceSetting.$inferSelect)["value"]

export async function readJobOperationSummaries(): Promise<{
  renditionSweep: AdminRenditionSweepSummary | null
  storageGc: AdminStorageGcSummary | null
}> {
  const rows = await db
    .select({ key: instanceSetting.key, value: instanceSetting.value })
    .from(instanceSetting)
    .where(inArray(instanceSetting.key, [RENDITION_SWEEP_KEY, STORAGE_GC_KEY]))
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    renditionSweep: parseSummary(
      values.get(RENDITION_SWEEP_KEY),
      AdminRenditionSweepSummarySchema,
    ),
    storageGc: parseSummary(
      values.get(STORAGE_GC_KEY),
      AdminStorageGcSummarySchema,
    ),
  }
}

// Validate persisted jsonb before it reaches the admin response. Invalid data
// is reported as no summary rather than crashing the dashboard.
function parseSummary<ValueSchema extends TSchema>(
  value: StoredSummaryValue | undefined,
  schema: ValueSchema,
): t.infer<ValueSchema> | null {
  if (value === undefined) return null
  const parsed = safeParse(schema, value)
  return parsed.success ? parsed.data : null
}
