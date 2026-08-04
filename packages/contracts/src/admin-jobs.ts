import type { JobKind } from "./jobs"
import { t } from "./schema"

/**
 * Sweep kinds an admin can trigger manually from the jobs dashboard. Only these
 * three have "run now" affordances; every other kind runs on its own schedule
 * or in response to uploads/playback.
 */
export const ADMIN_SWEEP_KINDS = [
  "clip.renditions-sweep",
  "clip.verify-assets",
  "storage.orphan-gc",
] as const satisfies readonly JobKind[]
export type AdminSweepKind = (typeof ADMIN_SWEEP_KINDS)[number]

const NonNegativeIntSchema = t.number().int().nonnegative()

export const AdminJobKindRowSchema = t.object({
  kind: t.string(),
  queue: t.string(),
  pending: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  completed: NonNegativeIntSchema,
  paused: t.boolean(),
  schedule: t
    .object({
      everyMs: t.number().int().positive(),
      nextRunAt: t.string().nullable(),
    })
    .optional(),
})
export type AdminJobKindRow = t.infer<typeof AdminJobKindRowSchema>

export const AdminRenditionSweepSummarySchema = t.object({
  finishedAt: t.string(),
  mode: t.enum(["stale", "force"]),
  scanned: NonNegativeIntSchema,
  upToDate: NonNegativeIntSchema,
  adopted: NonNegativeIntSchema,
  enqueued: NonNegativeIntSchema,
  unprobed: NonNegativeIntSchema,
  quarantined: NonNegativeIntSchema,
})
export type AdminRenditionSweepSummary = t.infer<
  typeof AdminRenditionSweepSummarySchema
>

export const AdminStorageVerifySummarySchema = t.object({
  finishedAt: t.string(),
  checked: NonNegativeIntSchema,
  missingRenditions: NonNegativeIntSchema,
  missingCuts: NonNegativeIntSchema,
  missingThumbs: NonNegativeIntSchema,
  missingSources: NonNegativeIntSchema,
  repaired: NonNegativeIntSchema,
})
export type AdminStorageVerifySummary = t.infer<
  typeof AdminStorageVerifySummarySchema
>

export const AdminStorageGcSummarySchema = t.object({
  finishedAt: t.string(),
  scanned: NonNegativeIntSchema,
  deletedOrphanObjects: NonNegativeIntSchema,
  deletedStaleAssets: NonNegativeIntSchema,
})
export type AdminStorageGcSummary = t.infer<typeof AdminStorageGcSummarySchema>

export const AdminJobsSweepsSchema = t.object({
  renditionSweep: AdminRenditionSweepSummarySchema.nullable(),
  storageVerify: AdminStorageVerifySummarySchema.nullable(),
  storageGc: AdminStorageGcSummarySchema.nullable(),
})
export type AdminJobsSweeps = t.infer<typeof AdminJobsSweepsSchema>

export const AdminJobsSummarySchema = t.object({
  kinds: t.array(AdminJobKindRowSchema),
  sweeps: AdminJobsSweepsSchema,
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
