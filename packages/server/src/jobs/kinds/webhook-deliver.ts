import { webhook, webhookDelivery } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import {
  clipPublishedPayload,
  discordContent,
} from "@alloy/server/webhooks/payload"
import {
  postWebhook,
  type WebhookSendResult,
} from "@alloy/server/webhooks/send"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import { defineJobKind } from "../registry"
import { enqueue } from "../store"

const WEBHOOK_DELIVER_KIND = "webhook.deliver"
const logger = createLogger("jobs")

const WebhookDeliverPayloadSchema = z.object({ deliveryId: z.uuid() })

defineJobKind({
  kind: WEBHOOK_DELIVER_KIND,
  queue: "io",
  schema: WebhookDeliverPayloadSchema,
  // Ahead of the storage sweeps that share the io queue: an announcement is
  // only useful while the clip is still new.
  defaultPriority: 20,
  retry: { maxAttempts: 5, backoffMs: 30_000 },
  handler: runWebhookDelivery,
  onFailed: markDeliveryFailed,
})

export function enqueueWebhookDelivery(deliveryId: string): Promise<string> {
  return enqueue(WEBHOOK_DELIVER_KIND, { deliveryId }, { dedupKey: deliveryId })
}

async function runWebhookDelivery(
  payload: z.infer<typeof WebhookDeliverPayloadSchema>,
): Promise<void> {
  const [row] = await db
    .select({
      status: webhookDelivery.status,
      clipId: webhookDelivery.clip_id,
      event: webhookDelivery.event,
      provider: webhook.provider,
      url: webhook.url,
      secret: webhook.secret,
      enabled: webhook.enabled,
      webhookId: webhook.id,
    })
    .from(webhookDelivery)
    .innerJoin(webhook, eq(webhookDelivery.webhook_id, webhook.id))
    .where(eq(webhookDelivery.id, payload.deliveryId))
    .limit(1)

  // The webhook was deleted; the ledger row went with it.
  if (!row) return
  // A retry that raced a successful attempt, or a webhook switched off after
  // the claim. Neither is an error, and neither should send anything.
  if (row.status === "succeeded") return
  if (!row.enabled) {
    await skipDelivery(payload.deliveryId, "Webhook is disabled")
    return
  }
  if (!row.clipId) {
    await skipDelivery(payload.deliveryId, "Delivery has no clip")
    return
  }

  const announcement = await clipPublishedPayload(
    row.clipId,
    payload.deliveryId,
  )
  if (!announcement) {
    await skipDelivery(payload.deliveryId, "Clip is no longer public")
    return
  }

  const result = await postWebhook(
    { provider: row.provider, url: row.url, secret: row.secret },
    {
      deliveryId: payload.deliveryId,
      event: row.event,
      content: discordContent(announcement),
      body: announcement,
    },
  )
  await recordAttempt(payload.deliveryId, row.webhookId, result)
  if (!result.ok) throw new Error(result.error)
}

async function recordAttempt(
  deliveryId: string,
  webhookId: string,
  result: WebhookSendResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(webhookDelivery)
      .set({
        attempts: sql`${webhookDelivery.attempts} + 1`,
        response_status: result.status,
        // A retryable failure leaves the row pending; only onFailed marks it
        // terminally failed, once the dispatcher stops re-arming it.
        ...(result.ok
          ? {
              status: "succeeded" as const,
              error: null,
              delivered_at: new Date(),
            }
          : { error: result.error }),
      })
      .where(eq(webhookDelivery.id, deliveryId))

    await tx
      .update(webhook)
      .set({
        last_delivery_at: new Date(),
        last_delivery_status: result.status,
        last_delivery_error: result.ok ? null : result.error,
        consecutive_failures: result.ok
          ? 0
          : sql`${webhook.consecutive_failures} + 1`,
        updated_at: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  })
}

/**
 * Terminal outcomes that are nobody's fault. The ledger row stays behind on
 * purpose: it already claimed this clip, and clearing it would let a
 * publish/unpublish cycle announce the clip a second time.
 */
async function skipDelivery(deliveryId: string, reason: string): Promise<void> {
  await db
    .update(webhookDelivery)
    .set({ status: "failed", error: reason })
    .where(eq(webhookDelivery.id, deliveryId))
}

async function markDeliveryFailed(
  payload: z.infer<typeof WebhookDeliverPayloadSchema>,
  error: Error,
  willRetry: boolean,
): Promise<void> {
  if (willRetry) return
  logger.error(`webhook delivery ${payload.deliveryId} gave up:`, error)
  await db
    .update(webhookDelivery)
    .set({ status: "failed" })
    .where(eq(webhookDelivery.id, payload.deliveryId))
}
