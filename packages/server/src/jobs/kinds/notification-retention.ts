import { createLogger } from "@alloy/logging"
import { client } from "@alloy/server/db/index"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind } from "../registry"

const logger = createLogger("jobs")

const EVERY_DAY_MS = 24 * 60 * 60 * 1000
const DELETE_BATCH_LIMIT = 1000
const MAX_BATCHES_PER_RUN = 20

defineJobKind({
  kind: "notification.prune",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_DAY_MS, runAtBoot: true },
  handler: pruneNotifications,
})

async function pruneNotifications(): Promise<void> {
  const expired = await deleteNotificationBatches(
    `created_at < now() - interval '90 days'`,
  )
  const read = await deleteNotificationBatches(
    `read_at is not null and created_at < now() - interval '30 days'`,
  )

  if (expired === 0 && read === 0) return
  logger.info(`notification retention pruned expired=${expired} read=${read}`)
}

async function deleteNotificationBatches(predicate: string): Promise<number> {
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const result = await client.query<{ id: string }>(
      `
        with doomed as (
          select id
          from notification
          where ${predicate}
          limit $1
        )
        delete from notification
        using doomed
        where notification.id = doomed.id
        returning notification.id
      `,
      [DELETE_BATCH_LIMIT],
    )
    const count = result.rowCount ?? result.rows.length
    deleted += count
    if (count < DELETE_BATCH_LIMIT) return deleted
  }
  return deleted
}
