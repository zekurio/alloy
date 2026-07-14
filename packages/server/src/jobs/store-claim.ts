import { job } from "@alloy/db/schema"
import { client, db } from "@alloy/server/db/index"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getJobKind } from "./registry"
import { leasedRunningJob } from "./store-database"
import { fail } from "./store-lifecycle"
import type { ClaimedJob } from "./store-types"

export async function claim(
  kinds: string[],
  leaseToken: string,
): Promise<ClaimedJob | null> {
  if (kinds.length === 0) return null
  for (;;) {
    const row = await claimRaw(kinds, leaseToken)
    if (!row) return null

    const registration = getJobKind(row.kind)
    if (!registration) {
      await markClaimedFailed(row.id, leaseToken, "unknown job kind")
      continue
    }

    const parsed = registration.schema.safeParse(row.payload)
    if (!parsed.success) {
      await markClaimedFailed(
        row.id,
        leaseToken,
        `invalid job payload: ${z.prettifyError(parsed.error)}`,
      )
      continue
    }

    return { ...row, payload: parsed.data }
  }
}

export async function heartbeat(
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const [row] = await db
    .update(job)
    .set({ locked_at: sql`now()`, updated_at: sql`now()` })
    .where(leasedRunningJob(id, leaseToken))
    .returning({ id: job.id })
  return Boolean(row)
}

async function claimRaw(
  kinds: string[],
  leaseToken: string,
): Promise<ClaimedJob | null> {
  const kindPlaceholders = kinds.map((_, index) => `$${index + 1}`).join(", ")
  const leaseTokenPlaceholder = `$${kinds.length + 1}`
  const result = await client.query<ClaimedJob>(
    `
      with candidate as (
        select j.id
        from job j
        where j.kind in (${kindPlaceholders})
          and (
            (j.status = 'pending' and j.run_at <= now())
            or (
              j.status = 'running'
              and j.locked_at < now() - interval '2 minutes'
            )
          )
          and not (
            j.status = 'pending'
            and j.dedup_key = j.kind
            and exists (
              select 1
              from job running
              where running.kind = j.kind
                and running.dedup_key = j.dedup_key
                and running.status = 'running'
                and running.locked_at >= now() - interval '2 minutes'
            )
          )
        order by j.priority asc, j.run_at asc, j.id asc
        limit 1
        for update skip locked
      )
      update job
      set
        status = 'running',
        lease_token = ${leaseTokenPlaceholder}::uuid,
        locked_at = now(),
        started_at = now(),
        attempt = attempt + 1,
        updated_at = now()
      from candidate
      where job.id = candidate.id
      returning
        job.id,
        job.kind,
        job.payload,
        job.status,
        job.priority,
        job.run_at,
        job.dedup_key,
        job.attempt,
        job.lease_token,
        job.locked_at,
        job.started_at,
        job.finished_at,
        job.progress,
        job.stage,
        job.error,
        job.created_at,
        job.updated_at
    `,
    [...kinds, leaseToken],
  )
  return result.rows[0] ?? null
}

async function markClaimedFailed(
  id: string,
  leaseToken: string,
  message: string,
): Promise<boolean> {
  const result = await fail(id, leaseToken, message, false)
  return result.changed
}
