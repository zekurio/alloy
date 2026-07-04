import type { z } from "zod"

export const JOB_QUEUES = ["encode", "io", "maintenance"] as const

export type JobQueue = (typeof JOB_QUEUES)[number]

export interface JobHandlerContext {
  signal: AbortSignal
  attempt: number
  jobId: string
  runId: string
  setProgress(pct: number, stage?: string): void
}

export interface JobSchedule {
  everyMs: number
  runAtBoot?: boolean
}

export interface JobRetry {
  maxAttempts: number
  backoffMs: number
}

export interface RegisteredJobKind<Schema extends z.ZodType = z.ZodType> {
  kind: string
  queue: JobQueue
  schema: Schema
  defaultPriority: number
  retry: JobRetry
  schedule?: JobSchedule
  handler: (
    payload: z.infer<Schema>,
    ctx: JobHandlerContext,
  ) => Promise<void> | void
  onFailed?: (
    payload: z.infer<Schema>,
    error: Error,
    willRetry: boolean,
    runId: string,
  ) => Promise<void> | void
  // Invoked by the admin retry path after a failed job is re-armed to pending,
  // before the queue is woken. Lets a kind restore side state its handler needs
  // (e.g. clip.encode flips a quarantined clip back to processing).
  onRetry?: (payload: z.infer<Schema>) => Promise<void> | void
  extendLease?: (
    payload: z.infer<Schema>,
    ctx: JobHandlerContext,
  ) => Promise<boolean | void> | boolean | void
}

const registrations = new Map<string, RegisteredJobKind>()

export function defineJobKind<Schema extends z.ZodType>(
  definition: RegisteredJobKind<Schema>,
): RegisteredJobKind<Schema> {
  if (registrations.has(definition.kind)) {
    throw new Error(`Duplicate job kind "${definition.kind}".`)
  }
  if (!JOB_QUEUES.includes(definition.queue)) {
    throw new Error(`Unknown queue "${definition.queue}".`)
  }
  if (definition.schedule && definition.schedule.everyMs <= 0) {
    throw new Error(`Recurring job "${definition.kind}" has no schedule.`)
  }
  registrations.set(definition.kind, definition)
  return definition
}

export function getJobKind(kind: string): RegisteredJobKind | undefined {
  return registrations.get(kind)
}

export function requireJobKind(kind: string): RegisteredJobKind {
  const registration = getJobKind(kind)
  if (!registration) throw new Error(`Unknown job kind "${kind}".`)
  return registration
}

export function registeredJobKinds(): RegisteredJobKind[] {
  return [...registrations.values()]
}

export function registeredKindsForQueue(queue: JobQueue): string[] {
  return registeredJobKinds()
    .filter((registration) => registration.queue === queue)
    .map((registration) => registration.kind)
}

export function recurringJobKinds(): RegisteredJobKind[] {
  return registeredJobKinds().filter((registration) => registration.schedule)
}
