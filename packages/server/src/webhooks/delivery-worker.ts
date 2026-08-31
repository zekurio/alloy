import { webhook, webhookDelivery } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"
import { and, asc, eq, sql } from "drizzle-orm"

import { webhookFailurePlan } from "./delivery-policy"
import { clipPublishedPayload, discordContent } from "./payload"
import { postWebhook, type WebhookSendResult } from "./send"

const logger = createLogger("webhooks")
const RECONCILE_INTERVAL_MS = 60_000

const worker = new WakeableSerialWorker({
  reconciliationIntervalMs: RECONCILE_INTERVAL_MS,
  runOne: deliverNextPending,
  onError: (cause) => logger.error("webhook outbox worker failed:", cause),
})

export function startWebhookDeliveryWorker(): void {
  worker.start()
}

export function wakeWebhookDeliveryWorker(): void {
  worker.wake()
}

export function stopWebhookDeliveryWorker(): Promise<void> {
  return worker.stop()
}

async function selectNextPending() {
  const [row] = await db
    .select({
      deliveryId: webhookDelivery.id,
      attempts: webhookDelivery.attempts,
      nextAttemptAt: webhookDelivery.next_attempt_at,
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
    .where(eq(webhookDelivery.status, "pending"))
    .orderBy(
      asc(webhookDelivery.next_attempt_at),
      asc(webhookDelivery.created_at),
    )
    .limit(1)
  return row ?? null
}

type PendingDelivery = NonNullable<
  Awaited<ReturnType<typeof selectNextPending>>
>

async function deliverNextPending(signal: AbortSignal) {
  const row = await selectNextPending()
  if (!row) return { worked: false as const, nextRunAt: null }
  if (row.nextAttemptAt.getTime() > Date.now()) {
    return { worked: false as const, nextRunAt: row.nextAttemptAt }
  }
  await deliverPending(row, signal)
  return { worked: true as const }
}

async function deliverPending(
  row: PendingDelivery,
  signal: AbortSignal,
): Promise<void> {
  if (!row.enabled) {
    await skipDelivery(row.deliveryId, "Webhook is disabled")
    return
  }
  if (!row.clipId) {
    await skipDelivery(row.deliveryId, "Delivery has no clip")
    return
  }

  let announcement
  try {
    announcement = await clipPublishedPayload(row.clipId, row.deliveryId)
  } catch (cause) {
    if (signal.aborted) return
    await recordAttempt(row, {
      ok: false,
      status: null,
      error: errorMessage(cause, "Could not build webhook payload"),
    })
    return
  }
  if (!announcement) {
    await skipDelivery(row.deliveryId, "Clip is no longer public")
    return
  }
  if (signal.aborted) return

  const result = await postWebhook(
    { provider: row.provider, url: row.url, secret: row.secret },
    {
      deliveryId: row.deliveryId,
      event: row.event,
      content: discordContent(announcement),
      body: announcement,
    },
    signal,
  )
  // Shutdown interruption leaves the durable row pending. It may have reached
  // the receiver, so the stable delivery ID remains the receiver's dedup key.
  if (signal.aborted) return
  await recordAttempt(row, result)
}

async function recordAttempt(
  row: PendingDelivery,
  result: WebhookSendResult,
): Promise<void> {
  const attemptedAt = new Date()
  const failure = webhookFailurePlan(row.attempts, attemptedAt)
  const terminalFailure = !result.ok && failure.terminal

  const updated = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .update(webhookDelivery)
      .set({
        attempts: sql`${webhookDelivery.attempts} + 1`,
        response_status: result.status,
        status: result.ok
          ? ("succeeded" as const)
          : terminalFailure
            ? ("failed" as const)
            : ("pending" as const),
        error: result.ok ? null : result.error,
        next_attempt_at: result.ok ? attemptedAt : failure.nextAttemptAt,
        delivered_at: result.ok ? attemptedAt : null,
      })
      .where(
        and(
          eq(webhookDelivery.id, row.deliveryId),
          eq(webhookDelivery.status, "pending"),
        ),
      )
      .returning({ id: webhookDelivery.id })
    if (!delivery) return false

    await tx
      .update(webhook)
      .set({
        last_delivery_at: attemptedAt,
        last_delivery_status: result.status,
        last_delivery_error: result.ok ? null : result.error,
        consecutive_failures: result.ok
          ? 0
          : sql`${webhook.consecutive_failures} + 1`,
        updated_at: attemptedAt,
      })
      .where(eq(webhook.id, row.webhookId))
    return true
  })

  if (!updated || result.ok) return
  if (terminalFailure) {
    logger.error(
      `webhook delivery ${row.deliveryId} gave up after ${failure.attempts} attempts: ${result.error}`,
    )
  } else {
    logger.warn(
      `webhook delivery ${row.deliveryId} failed; retrying at ${failure.nextAttemptAt.toISOString()}: ${result.error}`,
    )
  }
}

/** Keep the dedup ledger for terminal non-delivery outcomes. */
async function skipDelivery(deliveryId: string, reason: string): Promise<void> {
  await db
    .update(webhookDelivery)
    .set({ status: "failed", error: reason })
    .where(
      and(
        eq(webhookDelivery.id, deliveryId),
        eq(webhookDelivery.status, "pending"),
      ),
    )
}
