/**
 * Canonical registry of the remaining generic background queues and kinds.
 * Legacy contract-1 admin projections are defined separately in admin-jobs.
 */
export const JOB_QUEUES = ["io", "maintenance"] as const
export type JobQueue = (typeof JOB_QUEUES)[number]

export const JOB_KINDS = [
  "auth.challenge-prune",
  "job.prune",
  "notification.prune",
  "storage.orphan-gc",
  "upload.cleanup",
] as const
export type JobKind = (typeof JOB_KINDS)[number]

const JOB_QUEUE_SET: ReadonlySet<string> = new Set(JOB_QUEUES)
const JOB_KIND_SET: ReadonlySet<string> = new Set(JOB_KINDS)

export function isJobQueue(value: string): value is JobQueue {
  return JOB_QUEUE_SET.has(value)
}

export function isJobKind(value: string): value is JobKind {
  return JOB_KIND_SET.has(value)
}
