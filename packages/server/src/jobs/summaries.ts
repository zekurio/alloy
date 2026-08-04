import {
  AdminRenditionSweepSummarySchema,
  AdminStorageGcSummarySchema,
  AdminStorageVerifySummarySchema,
  type AdminJobsSweeps,
} from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { inArray } from "drizzle-orm"
import type { TSchema } from "typebox"

// Instance-setting keys the sweep handlers write their last-run summaries to.
const RENDITION_SWEEP_KEY = "renditionSweep"
const STORAGE_VERIFY_KEY = "storageVerify"
const STORAGE_GC_KEY = "storageGc"

const PersistedRenditionSweepSummarySchema =
  AdminRenditionSweepSummarySchema.extend({
    mode: t.enum(["stale", "force"]).$default("stale"),
  })

export async function readJobSweeps(): Promise<AdminJobsSweeps> {
  const rows = await db
    .select({ key: instanceSetting.key, value: instanceSetting.value })
    .from(instanceSetting)
    .where(
      inArray(instanceSetting.key, [
        RENDITION_SWEEP_KEY,
        STORAGE_VERIFY_KEY,
        STORAGE_GC_KEY,
      ]),
    )
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    renditionSweep: parseSummary(
      values.get(RENDITION_SWEEP_KEY),
      PersistedRenditionSweepSummarySchema,
    ),
    storageVerify: parseSummary(
      values.get(STORAGE_VERIFY_KEY),
      AdminStorageVerifySummarySchema,
    ),
    storageGc: parseSummary(
      values.get(STORAGE_GC_KEY),
      AdminStorageGcSummarySchema,
    ),
  }
}

// Summaries are persisted jsonb written by older code paths, so a shape that no
// longer parses is surfaced as "no data" rather than crashing the dashboard.
function parseSummary<ValueSchema extends TSchema>(
  value: unknown,
  schema: ValueSchema,
): t.infer<ValueSchema> | null {
  if (value === undefined) return null
  const parsed = safeParse(schema, value)
  return parsed.success ? parsed.data : null
}
