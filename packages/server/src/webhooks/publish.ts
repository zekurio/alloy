import { user } from "@alloy/db/auth-schema"
import { clip, webhook, webhookDelivery } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { and, eq, isNull } from "drizzle-orm"

import { enqueueWebhookDelivery } from "../jobs/kinds/webhook-deliver"

const logger = createLogger("webhooks")

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

/**
 * Claim and enqueue a `clip.published` delivery for every enabled webhook that
 * has not already received this clip.
 *
 * The ledger row is written before anything leaves the server, so an author
 * cannot re-announce by flipping a clip between public and private: the second
 * publish conflicts with the first claim and enqueues nothing. The cost of that
 * guarantee is that a webhook which is down through every retry loses the clip
 * permanently — the failed job stays in the admin dashboard as the recovery
 * path.
 */
export async function dispatchClipPublished(clipId: string): Promise<void> {
  const [row] = await db
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
  if (!row || !row.announcementsEnabled) return

  const targets = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.enabled, true))
  if (targets.length === 0) return

  const claimed = await db
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

  // enqueue() wakes the io queue itself; these are not transactional inserts.
  for (const delivery of claimed) {
    await enqueueWebhookDelivery(delivery.id)
  }
}
