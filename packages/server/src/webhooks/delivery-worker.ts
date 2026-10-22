import { isMessageWebhookProvider } from "@alloy/contracts"
import { webhook, webhookDelivery } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm"

import { clipPublishedPayload, messageWebhookContent } from "./payload"
import { sendWebhook, type WebhookSendResult } from "./send"

const logger = createLogger("webhooks")
const RECONCILE_INTERVAL_MS = 60_000
const MAX_ATTEMPTS = 5
const RETRY_BACKOFF_MS = 30_000
// Bounds for a wait the endpoint asked for; linear backoff applies otherwise.
const RETRY_AFTER_MIN_MS = 1_000
const RETRY_AFTER_MAX_MS = 15 * 60_000

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
      createdAt: webhookDelivery.created_at,
      attempts: webhookDelivery.attempts,
      nextAttemptAt: webhookDelivery.next_attempt_at,
      clipId: webhookDelivery.clip_id,
      event: webhookDelivery.event,
      provider: webhook.provider,
      url: webhook.url,
      secret: webhook.secret,
      webhookId: webhook.id,
    })
    .from(webhookDelivery)
    .innerJoin(webhook, eq(webhookDelivery.webhook_id, webhook.id))
    // A paused webhook holds its queue. The admin route wakes this worker
    // when the webhook is enabled again.
    .where(
      and(eq(webhookDelivery.status, "pending"), eq(webhook.enabled, true)),
    )
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
type FailedSend = Extract<WebhookSendResult, { ok: false }>

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
  if (!row.clipId) {
    await skipDelivery(row.deliveryId, "Delivery has no clip")
    return
  }

  let announcement
  try {
    announcement = await clipPublishedPayload(
      row.clipId,
      row.deliveryId,
      row.createdAt,
    )
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
    await skipDelivery(row.deliveryId, "Clip is no longer announceable")
    return
  }
  // Shutdown stops between deliveries, never during one: once the request is
  // out, its result must be recorded or a restart resends the message.
  if (signal.aborted) return

  let messageId: string | undefined
  if (isMessageWebhookProvider(row.provider)) {
    // Message IDs belong to a clip AND a configured webhook. Each destination
    // can be edited or retried independently of the others.
    const [previous] = await db
      .select({ messageId: webhookDelivery.discord_message_id })
      .from(webhookDelivery)
      .where(
        and(
          eq(webhookDelivery.webhook_id, row.webhookId),
          eq(webhookDelivery.clip_id, row.clipId),
          eq(webhookDelivery.status, "succeeded"),
          isNotNull(webhookDelivery.discord_message_id),
        ),
      )
      .orderBy(desc(webhookDelivery.delivered_at), desc(webhookDelivery.id))
      .limit(1)
    messageId = previous?.messageId ?? undefined
  }

  const result = await sendWebhook(
    { provider: row.provider, url: row.url, secret: row.secret },
    {
      deliveryId: row.deliveryId,
      event: row.event,
      content: messageWebhookContent(announcement),
      body: announcement,
      messageId,
    },
  )
  await recordAttempt(row, result)
  if (
    result.ok &&
    isMessageWebhookProvider(row.provider) &&
    !result.messageId
  ) {
    logger.warn(`webhook delivery ${row.deliveryId} returned no message ID`)
  }
}

async function recordAttempt(
  row: PendingDelivery,
  result: WebhookSendResult,
): Promise<void> {
  const attemptedAt = new Date()
  const attempts = row.attempts + 1
  const terminal = !result.ok && attempts >= MAX_ATTEMPTS
  const retryAt = result.ok
    ? attemptedAt
    : nextAttemptAt(result, attempts, attemptedAt)

  const updated = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .update(webhookDelivery)
      .set({
        attempts: sql`${webhookDelivery.attempts} + 1`,
        response_status: result.status,
        discord_message_id: result.ok ? (result.messageId ?? null) : null,
        status: result.ok
          ? ("succeeded" as const)
          : terminal
            ? ("failed" as const)
            : ("pending" as const),
        error: result.ok ? null : result.error,
        next_attempt_at: terminal ? attemptedAt : retryAt,
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

    // The endpoint asked for a pause, so everything queued for it waits.
    // Otherwise each queued delivery would spend an attempt learning the same
    // thing, and a burst to a rate-limited Discord webhook would lose clips.
    if (!result.ok && result.retryAfterMs !== undefined) {
      await tx
        .update(webhookDelivery)
        .set({
          next_attempt_at: sql`greatest(${webhookDelivery.next_attempt_at}, ${retryAt.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(webhookDelivery.webhook_id, row.webhookId),
            eq(webhookDelivery.status, "pending"),
          ),
        )
    }

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
  if (terminal) {
    logger.error(
      `webhook delivery ${row.deliveryId} gave up after ${attempts} attempts: ${result.error}`,
    )
  } else {
    logger.warn(
      `webhook delivery ${row.deliveryId} failed; retrying at ${retryAt.toISOString()}: ${result.error}`,
    )
  }
}

function nextAttemptAt(
  result: FailedSend,
  attempts: number,
  attemptedAt: Date,
): Date {
  const delayMs =
    result.retryAfterMs === undefined
      ? RETRY_BACKOFF_MS * attempts
      : Math.min(
          RETRY_AFTER_MAX_MS,
          Math.max(RETRY_AFTER_MIN_MS, result.retryAfterMs),
        )
  return new Date(attemptedAt.getTime() + delayMs)
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
