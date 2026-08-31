import type { JobQueue } from "./jobs"
import { t } from "./schema"

/** Contract-1 queue labels, including the retired encode queue adapter. */
export const ADMIN_JOB_QUEUES = [
  "encode",
  "io",
  "maintenance",
] as const satisfies readonly ("encode" | JobQueue)[]
export type AdminJobQueue = (typeof ADMIN_JOB_QUEUES)[number]

/**
 * Sweep kinds an admin can trigger with the generic sweep route. Storage
 * cleanup uses separate preview and confirm routes.
 */
export const ADMIN_SWEEP_KINDS = ["clip.renditions-sweep"] as const
export type AdminSweepKind = (typeof ADMIN_SWEEP_KINDS)[number]

const NonNegativeIntSchema = t.number().int().nonnegative()

const AdminJobCountsSchema = t.object({
  pending: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  completed: NonNegativeIntSchema,
})

export const AdminJobQueueRowSchema = t.object({
  queue: t.enum(ADMIN_JOB_QUEUES),
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
  jobId: t.string().uuid(),
  previewJobId: t.string().uuid(),
  mode: t.enum(["preview", "delete"]),
  finishedAt: t.string().datetime({ offset: true }),
  confirmationExpiresAt: t.string().datetime({ offset: true }).nullable(),
  cutoffAt: t.string().datetime({ offset: true }),
  hasMoreCandidates: t.boolean(),
  scanned: NonNegativeIntSchema,
  orphanCandidates: NonNegativeIntSchema,
  staleAssetCandidates: NonNegativeIntSchema,
  deletedOrphanObjects: NonNegativeIntSchema,
  deletedStaleAssets: NonNegativeIntSchema,
  deleteFailures: NonNegativeIntSchema,
})
export type AdminStorageGcSummary = t.infer<typeof AdminStorageGcSummarySchema>

export const AdminJobEnqueueResponseSchema = t.object({
  jobId: t.string().uuid(),
})
export type AdminJobEnqueueResponse = t.infer<
  typeof AdminJobEnqueueResponseSchema
>

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
  retryable: t.boolean(),
})
export type AdminFailedJob = t.infer<typeof AdminFailedJobSchema>

export const AdminFailedJobsPageSchema = t.object({
  items: t.array(AdminFailedJobSchema),
  nextCursor: t.string().nullable(),
})
export type AdminFailedJobsPage = t.infer<typeof AdminFailedJobsPageSchema>
