import { job } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { sql } from "drizzle-orm"

import { recurringJobKinds, type RegisteredJobKind } from "./registry"

type JobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const MAX_BOOT_JITTER_MS = 30_000

export async function ensureScheduled(): Promise<void> {
  for (const registration of recurringJobKinds()) {
    await db
      .insert(job)
      .values({
        kind: registration.kind,
        payload: {},
        priority: registration.defaultPriority,
        dedup_key: registration.kind,
        run_at: sql`now() + ${initialDelayMs(registration)} * interval '1 millisecond'`,
      })
      .onConflictDoNothing({
        target: [job.kind, job.dedup_key],
        where: sql`${job.status} = 'pending' and ${job.dedup_key} is not null`,
      })
  }
}

export async function rearmRecurringJob(
  tx: JobTransaction,
  registration: RegisteredJobKind,
): Promise<void> {
  if (!registration.schedule) return
  await tx
    .insert(job)
    .values({
      kind: registration.kind,
      payload: {},
      priority: registration.defaultPriority,
      dedup_key: registration.kind,
      run_at: sql`now() + ${
        registration.schedule.everyMs + deterministicJitterMs(registration.kind)
      } * interval '1 millisecond'`,
    })
    .onConflictDoNothing({
      target: [job.kind, job.dedup_key],
      where: sql`${job.status} = 'pending' and ${job.dedup_key} is not null`,
    })
}

function initialDelayMs(registration: RegisteredJobKind): number {
  if (registration.schedule?.runAtBoot) {
    return deterministicJitterMs(registration.kind)
  }
  return (
    (registration.schedule?.everyMs ?? 0) +
    deterministicJitterMs(registration.kind)
  )
}

function deterministicJitterMs(kind: string): number {
  const hash = Array.from(kind).reduce(
    (value, char) => value + char.charCodeAt(0),
    0,
  )
  return hash % MAX_BOOT_JITTER_MS
}
