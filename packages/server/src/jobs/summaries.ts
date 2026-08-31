import {
  AdminRenditionSweepSummarySchema,
  AdminStorageGcSummarySchema,
  type AdminRenditionSweepSummary,
  type AdminStorageGcSummary,
} from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { clip, instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { TSchema } from "typebox"

// Instance-setting keys the sweep handlers write their last-run summaries to.
const RENDITION_SWEEP_KEY = "renditionSweep"
const STORAGE_GC_KEY = "storageGc"
const StoredMediaGenerationSchema = t.object({
  generation: t.number().int().min(1),
})
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

/**
 * Keep the contract-1 rendition-sweep summary meaningful while reconciliation
 * is owned directly by clip generations instead of a sweep job.
 */
export async function writeMediaReconciliationSummary(
  generation: number,
  mode: AdminRenditionSweepSummary["mode"],
): Promise<AdminRenditionSweepSummary | null> {
  // Preserve the old sweep's mutually exclusive precedence while projecting
  // it from generation-owned state. Force classifies every eligible clip as
  // enqueued; stale mode reports unprobed/current/quarantined before fallback.
  const classification = sql<string>`case
    when ${mode}::text = 'force' then 'enqueued'
    when ${clip.height} is null or ${clip.source_fps} is null then 'unprobed'
    when ${clip.encode_request_id} is not null or ${clip.encode_run_id} is not null then 'enqueued'
    when ${clip.encode_generation} = ${generation}
      and ${clip.thumb_key} is null
      and ${clip.thumb_failed_at} is null then 'enqueued'
    when ${clip.encode_generation} = ${generation} then 'up-to-date'
    when ${clip.encode_failed_generation} = ${generation} then 'quarantined'
    else 'enqueued'
  end`
  const [counts] = await db
    .select({
      scanned: sql<number>`count(*)::int`,
      upToDate: sql<number>`count(*) filter (where ${classification} = 'up-to-date')::int`,
      enqueued: sql<number>`count(*) filter (where ${classification} = 'enqueued')::int`,
      unprobed: sql<number>`count(*) filter (where ${classification} = 'unprobed')::int`,
      quarantined: sql<number>`count(*) filter (where ${classification} = 'quarantined')::int`,
    })
    .from(clip)
    .where(and(eq(clip.status, "ready"), isNotNull(clip.source_key)))

  const summary: AdminRenditionSweepSummary = {
    finishedAt: new Date().toISOString(),
    mode,
    scanned: counts?.scanned ?? 0,
    upToDate: counts?.upToDate ?? 0,
    enqueued: counts?.enqueued ?? 0,
    unprobed: counts?.unprobed ?? 0,
    quarantined: counts?.quarantined ?? 0,
  }
  const stored = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ value: instanceSetting.value })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, "mediaEncodeGeneration"))
      .limit(1)
      .for("update")
    const parsed = safeParse(StoredMediaGenerationSchema, current?.value)
    if (!parsed.success || parsed.data.generation !== generation) return false

    await tx
      .insert(instanceSetting)
      .values({
        key: RENDITION_SWEEP_KEY,
        value: summary,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: instanceSetting.key,
        set: { value: summary, updated_at: new Date() },
      })
    return true
  })
  return stored ? summary : null
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
