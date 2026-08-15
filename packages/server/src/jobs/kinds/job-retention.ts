import { client } from "@alloy/server/db/index"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind } from "../registry"
import { prune } from "../store"

const EVERY_DAY_MS = 24 * 60 * 60 * 1000

defineJobKind({
  kind: "job.prune",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_DAY_MS, runAtBoot: true },
  handler: pruneJobHistory,
})

async function pruneJobHistory(): Promise<void> {
  const cutoffs = await client.query<{
    completedBefore: Date
    failedBefore: Date
  }>(
    "select now() - interval '7 days' as \"completedBefore\", now() - interval '90 days' as \"failedBefore\"",
  )
  const row = cutoffs.rows[0]
  if (!row) return
  await prune(row.completedBefore, row.failedBefore)
}
