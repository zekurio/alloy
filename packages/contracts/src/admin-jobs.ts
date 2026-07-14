import { z } from "zod"

import type { JobKind } from "./jobs"

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

const NonNegativeIntSchema = z.number().int().nonnegative()

export const AdminJobKindRowSchema = z.object({
  kind: z.string(),
  queue: z.string(),
  pending: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  completed: NonNegativeIntSchema,
  paused: z.boolean(),
  schedule: z
    .object({
      everyMs: z.number().int().positive(),
      nextRunAt: z.string().nullable(),
    })
    .optional(),
})
export type AdminJobKindRow = z.infer<typeof AdminJobKindRowSchema>

export const AdminRenditionSweepSummarySchema = z.object({
  finishedAt: z.string(),
  mode: z.enum(["stale", "force"]),
  scanned: NonNegativeIntSchema,
  upToDate: NonNegativeIntSchema,
  adopted: NonNegativeIntSchema,
  enqueued: NonNegativeIntSchema,
  unprobed: NonNegativeIntSchema,
  quarantined: NonNegativeIntSchema,
})
export type AdminRenditionSweepSummary = z.infer<
  typeof AdminRenditionSweepSummarySchema
>

export const AdminStorageVerifySummarySchema = z.object({
  finishedAt: z.string(),
  checked: NonNegativeIntSchema,
  missingRenditions: NonNegativeIntSchema,
  missingCuts: NonNegativeIntSchema,
  missingThumbs: NonNegativeIntSchema,
  missingSources: NonNegativeIntSchema,
  repaired: NonNegativeIntSchema,
})
export type AdminStorageVerifySummary = z.infer<
  typeof AdminStorageVerifySummarySchema
>

export const AdminStorageGcSummarySchema = z.object({
  finishedAt: z.string(),
  scanned: NonNegativeIntSchema,
  deletedOrphanObjects: NonNegativeIntSchema,
  deletedStaleAssets: NonNegativeIntSchema,
})
export type AdminStorageGcSummary = z.infer<typeof AdminStorageGcSummarySchema>

export const AdminJobsSweepsSchema = z.object({
  renditionSweep: AdminRenditionSweepSummarySchema.nullable(),
  storageVerify: AdminStorageVerifySummarySchema.nullable(),
  storageGc: AdminStorageGcSummarySchema.nullable(),
})
export type AdminJobsSweeps = z.infer<typeof AdminJobsSweepsSchema>

export const AdminJobsSummarySchema = z.object({
  kinds: z.array(AdminJobKindRowSchema),
  sweeps: AdminJobsSweepsSchema,
})
export type AdminJobsSummary = z.infer<typeof AdminJobsSummarySchema>

export const AdminFailedJobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  clipId: z.string().nullable(),
  error: z.string().nullable(),
  attempt: NonNegativeIntSchema,
  finishedAt: z.string().nullable(),
})
export type AdminFailedJob = z.infer<typeof AdminFailedJobSchema>

export const AdminFailedJobsPageSchema = z.object({
  items: z.array(AdminFailedJobSchema),
  nextCursor: z.string().nullable(),
})
export type AdminFailedJobsPage = z.infer<typeof AdminFailedJobsPageSchema>
