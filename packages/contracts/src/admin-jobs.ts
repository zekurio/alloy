import { JOB_QUEUES, type JobKind, type JobQueue } from "./jobs"
import { t } from "./schema"

/**
 * Sweep kinds an admin can trigger manually from the jobs dashboard. Only these
 * two have "run now" affordances; every other kind runs on its own schedule
 * or in response to product events.
 */
export const ADMIN_SWEEP_KINDS = [
  "clip.renditions-sweep",
  "storage.orphan-gc",
] as const satisfies readonly JobKind[]
export type AdminSweepKind = (typeof ADMIN_SWEEP_KINDS)[number]

const NonNegativeIntSchema = t.number().int().nonnegative()

const AdminJobCountsSchema = t.object({
  pending: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  completed: NonNegativeIntSchema,
})

export const AdminJobQueueRowSchema = t.object({
  queue: t.enum(JOB_QUEUES satisfies readonly JobQueue[]),
  ...AdminJobCountsSchema.properties,
})
export type AdminJobQueueRow = t.infer<typeof AdminJobQueueRowSchema>

export const AdminRenditionSweepSummarySchema = t.object({
  finishedAt: t.string().datetime({ offset: true }),
  mode: t.enum(["stale", "force"]),
  scanned: NonNegativeIntSchema,
  upToDate: NonNegativeIntSchema,
  enqueued: NonNegativeIntSchema,
  unprobed: NonNegativeIntSchema,
  quarantined: NonNegativeIntSchema,
})
export type AdminRenditionSweepSummary = t.infer<
  typeof AdminRenditionSweepSummarySchema
>

export const AdminStorageGcSummarySchema = t.object({
  finishedAt: t.string().datetime({ offset: true }),
  scanned: NonNegativeIntSchema,
  deletedOrphanObjects: NonNegativeIntSchema,
  deletedStaleAssets: NonNegativeIntSchema,
})
export type AdminStorageGcSummary = t.infer<typeof AdminStorageGcSummarySchema>

export const AdminJobOperationsSchema = t.object({
  renditionSweep: t.object({
    ...AdminJobCountsSchema.properties,
    summary: AdminRenditionSweepSummarySchema.nullable(),
  }),
  storageGc: t.object({
    ...AdminJobCountsSchema.properties,
    summary: AdminStorageGcSummarySchema.nullable(),
  }),
})
export type AdminJobOperations = t.infer<typeof AdminJobOperationsSchema>

export const AdminJobsSummarySchema = t.object({
  queues: t.array(AdminJobQueueRowSchema),
  operations: AdminJobOperationsSchema,
})
export type AdminJobsSummary = t.infer<typeof AdminJobsSummarySchema>

export const AdminFailedJobSchema = t.object({
  id: t.string(),
  kind: t.string(),
  clipId: t.string().nullable(),
  error: t.string().nullable(),
  attempt: NonNegativeIntSchema,
  finishedAt: t.string().nullable(),
})
export type AdminFailedJob = t.infer<typeof AdminFailedJobSchema>

export const AdminFailedJobsPageSchema = t.object({
  items: t.array(AdminFailedJobSchema),
  nextCursor: t.string().nullable(),
})
export type AdminFailedJobsPage = t.infer<typeof AdminFailedJobsPageSchema>
