import { job } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, eq, inArray, sql } from "drizzle-orm"

import { publishQueueWake } from "./events"
import { requireJobKind } from "./registry"
import type { EnqueueOptions } from "./store-types"

export async function enqueue(
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string> {
  const registration = requireJobKind(kind)
  const parsed = registration.schema.parse(payload)
  const executor = options.tx ?? db
  const [row] = await executor
    .insert(job)
    .values({
      kind,
      payload: parsed,
      priority: options.priority ?? registration.defaultPriority,
      run_at: options.runAt ?? sql`now()`,
      dedup_key: options.dedupKey,
    })
    .onConflictDoUpdate({
      target: [job.kind, job.dedup_key],
      targetWhere: pendingDedupPredicate(),
      setWhere: pendingDedupPredicate(),
      set: {
        payload: sql`excluded.payload`,
        priority: sql`least(${job.priority}, excluded.priority)`,
        run_at: sql`least(${job.run_at}, excluded.run_at)`,
        updated_at: sql`now()`,
      },
    })
    .returning({ id: job.id })
  if (!row) throw new Error(`Could not enqueue job "${kind}".`)
  if (options.tx) return row.id
  publishQueueWake(registration.queue)
  return row.id
}

export function wakeQueueForKind(kind: string): void {
  publishQueueWake(requireJobKind(kind).queue)
}

export async function hasLiveJob(
  kind: string,
  dedupKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.kind, kind),
        eq(job.dedup_key, dedupKey),
        inArray(job.status, ["pending", "running"]),
      ),
    )
    .limit(1)
  return Boolean(row)
}

function pendingDedupPredicate() {
  return sql`${job.status} = 'pending' and ${job.dedup_key} is not null`
}
