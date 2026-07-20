/**
 * Canonical registry of background job queues and kinds.
 *
 * This list is the single source of truth shared by the server and the web
 * admin dashboard: the server's defineJobKind() only accepts kinds declared
 * here, and the dashboard's label maps must cover every kind and queue. Both
 * sides are enforced at compile time, so adding a job kind without updating
 * the contract — or without giving it a dashboard label — fails typecheck.
 * A server test additionally asserts that registered kinds match this list
 * exactly, so stale entries are caught too.
 */
export const JOB_QUEUES = ["encode", "io", "maintenance"] as const
export type JobQueue = (typeof JOB_QUEUES)[number]

export const JOB_KINDS = [
  "clip.encode",
  "clip.renditions-sweep",
  "clip.verify",
  "clip.verify-assets",
  "maintenance.run",
  "notification.prune",
  "storage.orphan-gc",
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
