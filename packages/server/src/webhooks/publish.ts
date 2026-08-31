import { user } from "@alloy/db/auth-schema"
import { clip, webhook, webhookDelivery } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, isNull } from "drizzle-orm"

import { wakeWebhookDeliveryWorker } from "./delivery-worker"

const logger = createLogger("webhooks")
type WebhookDbExecutor = typeof db | DbTransaction

/**
 * Fire-and-forget dispatch: a webhook problem must never fail, and therefore
 * re-run, the encode or metadata write it rode in on, so errors are logged
 * rather than thrown.
 */
export function announceClipPublished(clipId: string): void {
  void dispatchClipPublished(clipId).catch((error) =>
    logger.error("webhook dispatch failed", error),
  )
}

export function clipPublishedDedupKey(clipId: string): string {
  return `clip.published:${clipId}`
}

/** Wake only after the transaction that claimed these rows has committed. */
export function wakeClaimedClipPublishedDeliveries(claimed: number): void {
  if (claimed > 0) wakeWebhookDeliveryWorker()
}

/**
 * Claim a `clip.published` delivery for every enabled webhook that
 * has not already received this clip.
 *
 * The ledger row is written before anything leaves the server, so an author
 * cannot re-announce by flipping a clip between public and private: the second
 * publish conflicts with the first claim and enqueues nothing. The cost of that
 * guarantee is that a webhook which is down through every retry loses the clip
 * permanently. The delivery row is both the dedup ledger and durable outbox,
 * so there is no second queue insert that can be lost after this commit.
 */
export async function claimClipPublishedDeliveries(
  executor: WebhookDbExecutor,
  clipId: string,
): Promise<number> {
  const [row] = await executor
    .select({
      announcementsEnabled: user.clip_announcements_enabled,
    })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .where(
      and(
        eq(clip.id, clipId),
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNull(user.disabled_at),
      ),
    )
    .limit(1)

  // Checked here rather than at delivery time so an opted-out author leaves no
  // ledger rows behind, and opting back in still announces their next publish.
  if (!row || !row.announcementsEnabled) return 0

  const targets = await executor
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.enabled, true))
  if (targets.length === 0) return 0

  const claimed = await executor
    .insert(webhookDelivery)
    .values(
      targets.map((target) => ({
        webhook_id: target.id,
        clip_id: clipId,
        event: "clip.published" as const,
        dedup_key: clipPublishedDedupKey(clipId),
      })),
    )
    .onConflictDoNothing({
      target: [webhookDelivery.webhook_id, webhookDelivery.dedup_key],
    })
    .returning({ id: webhookDelivery.id })

  return claimed.length
}

export async function dispatchClipPublished(clipId: string): Promise<void> {
  const claimed = await claimClipPublishedDeliveries(db, clipId)
  // The direct dispatcher writes outside a caller-owned transaction, so its
  // insert has committed here. Startup/reconciliation scans recover if this
  // process exits before the latency-only wake.
  wakeClaimedClipPublishedDeliveries(claimed)
}
