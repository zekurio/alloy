import { authChallenge } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { lt, sql } from "drizzle-orm"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind } from "../registry"

const EVERY_10_MINUTES_MS = 10 * 60 * 1000

defineJobKind({
  kind: "auth.challenge-prune",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_10_MINUTES_MS, runAtBoot: true },
  handler: pruneExpiredAuthChallenges,
})

async function pruneExpiredAuthChallenges(): Promise<void> {
  await db.delete(authChallenge).where(lt(authChallenge.expires_at, sql`now()`))
}
