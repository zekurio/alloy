import { JOB_QUEUES, type JobKind, type JobQueue } from "@alloy/contracts"
import type { t } from "@alloy/contracts/schema"
import type { TSchema } from "typebox"

import type { JobTransaction } from "./store-types"

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

export type JobAfterCommit = () => Promise<void> | void

export interface JobFailureContext {
  willRetry: boolean
  runId: string
  tx: JobTransaction
}

export interface RegisteredJobKind<ValueSchema extends TSchema = TSchema> {
  kind: JobKind
  queue: JobQueue
  schema: ValueSchema
  defaultPriority: number
  retry: JobRetry
  schedule?: JobSchedule
  handler: (
    payload: t.infer<ValueSchema>,
    ctx: JobHandlerContext,
  ) => Promise<void> | void
  // Runs in the same transaction that moves the job to pending or failed.
  // Return external cleanup or event work that must run after commit.
  onFailed?: (
    payload: t.infer<ValueSchema>,
    error: Error,
    ctx: JobFailureContext,
  ) => Promise<JobAfterCommit | void> | JobAfterCommit | void
  // Invoked in the same transaction that re-arms a failed job. Lets a kind
  // restore side state before a dispatcher can see the pending job.
  onRetry?: (
    payload: t.infer<ValueSchema>,
    tx: JobTransaction,
  ) => Promise<void> | void
  extendLease?: (
    payload: t.infer<ValueSchema>,
    ctx: JobHandlerContext,
  ) => Promise<boolean | void> | boolean | void
}

const registrations = new Map<string, RegisteredJobKind>()

export function defineJobKind<ValueSchema extends TSchema>(
  definition: RegisteredJobKind<ValueSchema>,
): RegisteredJobKind<ValueSchema> {
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
