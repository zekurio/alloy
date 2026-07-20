import { DISCORD_PROVIDER_ID, type WebhooksConfig } from "@alloy/contracts"
import { authAccount, user } from "@alloy/db/auth-schema"
import { clip, game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  announceTemplateValues,
  clipPublicUrl,
  clipThumbnailUrl,
  discordAnnounceFiles,
  discordAnnouncePayload,
  gamePublicUrl,
  postGenericWebhook,
  type ClipAnnouncement,
} from "@alloy/server/webhooks/deliver"
import {
  deleteDiscordWebhookMessage,
  executeDiscordWebhook,
} from "@alloy/server/webhooks/discord"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineJobKind } from "../registry"
import { enqueue, wakeQueueForKind, type EnqueueOptions } from "../store"

const WEBHOOK_SYNC_KIND = "webhook.sync"
const WEBHOOK_RETRACT_KIND = "webhook.retract"
const logger = createLogger("jobs")

const WebhookSyncPayloadSchema = z.object({
  clipId: z.uuid(),
})

const WebhookRetractPayloadSchema = z.object({
  messageId: z.string().min(1),
})

// Reconciler: reads the clip's *current* state at run time and converges the
// external announcement, so rapid public→private→public flips end correct
// regardless of run ordering. Dedup by clip id keeps one live job per clip.
defineJobKind({
  kind: WEBHOOK_SYNC_KIND,
  queue: "io",
  schema: WebhookSyncPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 5, backoffMs: 30_000 },
  handler: runWebhookSync,
})

// One-shot retract for deleted clips: the clip row is gone before the
// reconciler could read it, so the payload carries the message id directly.
defineJobKind({
  kind: WEBHOOK_RETRACT_KIND,
  queue: "io",
  schema: WebhookRetractPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 5, backoffMs: 30_000 },
  handler: runWebhookRetract,
})

export function enqueueWebhookSync(
  clipId: string,
  options: { tx?: EnqueueOptions["tx"] } = {},
): Promise<string> {
  return enqueue(
    WEBHOOK_SYNC_KIND,
    { clipId },
    { dedupKey: clipId, tx: options.tx },
  )
}

export function enqueueWebhookRetract(
  messageId: string,
  options: { tx?: EnqueueOptions["tx"] } = {},
): Promise<string> {
  return enqueue(
    WEBHOOK_RETRACT_KIND,
    { messageId },
    { dedupKey: messageId, tx: options.tx },
  )
}

/** Wake the io queue after a transaction that enqueued webhook work commits. */
export function wakeWebhookQueue(): void {
  wakeQueueForKind(WEBHOOK_SYNC_KIND)
}

async function runWebhookSync(
  payload: z.infer<typeof WebhookSyncPayloadSchema>,
): Promise<void> {
  const config = configStore.get("webhooks")
  const row = await selectClipAnnounceState(payload.clipId)
  // Deleted clips are handled by the delete flow's one-shot retract.
  if (!row) return

  const shouldAnnounce = row.status === "ready" && row.privacy === "public"
  if (shouldAnnounce && !row.announcedAt) {
    await announce(payload.clipId, row, config)
    return
  }
  if (!shouldAnnounce && (row.announcedAt || row.announceMessageId)) {
    await retract(payload.clipId, row.announceMessageId, config)
  }
}

async function runWebhookRetract(
  payload: z.infer<typeof WebhookRetractPayloadSchema>,
): Promise<void> {
  const config = configStore.get("webhooks")
  // Without the webhook URL the message cannot be addressed anymore
  // (config was cleared); nothing left to converge.
  if (!config.discord.webhookUrl) return
  await deleteDiscordWebhookMessage(
    config.discord.webhookUrl,
    payload.messageId,
  )
}

type ClipAnnounceState = ClipAnnouncement & {
  status: typeof clip.$inferSelect.status
  privacy: typeof clip.$inferSelect.privacy
  announcedAt: Date | null
  announceMessageId: string | null
  authorId: string
}

async function selectClipAnnounceState(
  clipId: string,
): Promise<ClipAnnounceState | null> {
  const [row] = await db
    .select({
      status: clip.status,
      privacy: clip.privacy,
      announcedAt: clip.announced_at,
      announceMessageId: clip.announce_message_id,
      authorId: clip.author_id,
      title: clip.title,
      game: clip.game,
      gameSlug: game.slug,
      gameGridUrl: game.grid_url,
      gameIconUrl: game.icon_url,
      durationMs: clip.duration_ms,
      thumbKey: clip.thumb_key,
      createdAt: clip.created_at,
      authorUsername: user.username,
      authorImage: user.image,
    })
    .from(clip)
    .innerJoin(user, eq(user.id, clip.author_id))
    .leftJoin(game, eq(game.id, clip.game_id))
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!row) return null
  return {
    clipUrl: clipPublicUrl(clipId),
    status: row.status,
    privacy: row.privacy,
    announcedAt: row.announcedAt,
    announceMessageId: row.announceMessageId,
    authorId: row.authorId,
    authorDiscordId: null,
    title: row.title,
    game: row.game,
    gameUrl: row.gameSlug !== null ? gamePublicUrl(row.gameSlug) : null,
    gameImageUrl: row.gameGridUrl ?? row.gameIconUrl,
    durationMs: row.durationMs,
    thumbnailUrl: row.thumbKey !== null ? clipThumbnailUrl(clipId) : null,
    createdAt: row.createdAt,
    authorUsername: row.authorUsername ?? "unknown",
    authorImage: row.authorImage,
  }
}

async function announce(
  clipId: string,
  announcement: ClipAnnounceState,
  config: WebhooksConfig,
): Promise<void> {
  const discordEnabled =
    config.discord.enabled && config.discord.webhookUrl.length > 0
  const genericEnabled = config.generic.enabled && config.generic.url.length > 0
  if (!discordEnabled && !genericEnabled) return

  // Discord first: nothing is persisted until the message exists, so a failed
  // execute retries cleanly without duplicates (dedup serializes runs).
  const messageId = discordEnabled
    ? (
        await executeDiscordWebhook(
          config.discord.webhookUrl,
          discordAnnouncePayload({
            ...announcement,
            authorDiscordId: await linkedDiscordAccountId(
              announcement.authorId,
            ),
          }),
          discordAnnounceFiles(),
        )
      ).messageId
    : null

  try {
    await db
      .update(clip)
      .set({ announced_at: new Date(), announce_message_id: messageId })
      .where(and(eq(clip.id, clipId), isNull(clip.announced_at)))
  } catch (err) {
    // A retry would repost the Discord message; best-effort delete the one
    // that was just created before surfacing the persist failure.
    if (messageId) {
      await deleteDiscordWebhookMessage(
        config.discord.webhookUrl,
        messageId,
      ).catch((deleteErr) =>
        logger.warn("webhook announce rollback delete failed", deleteErr),
      )
    }
    throw err
  }

  // The generic webhook is announce-only best effort: failing the job after
  // the Discord message exists would duplicate it on retry, so log instead.
  if (genericEnabled) {
    await postGenericWebhook(
      config.generic,
      announceTemplateValues(announcement),
    ).catch((err) =>
      logger.error(`generic webhook announce failed for clip ${clipId}`, err),
    )
  }
}

/** Snowflake of the author's linked Discord account, if any. */
async function linkedDiscordAccountId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ providerAccountId: authAccount.provider_account_id })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.user_id, userId),
        eq(authAccount.provider_id, DISCORD_PROVIDER_ID),
      ),
    )
    .limit(1)
  return row?.providerAccountId ?? null
}

async function retract(
  clipId: string,
  messageId: string | null,
  config: WebhooksConfig,
): Promise<void> {
  // Delete before clearing state: clearing first would strand the message
  // with no record of it if the delete then fails. A missing webhook URL
  // (config cleared) leaves the message unaddressable; clear state anyway.
  if (messageId && config.discord.webhookUrl) {
    await deleteDiscordWebhookMessage(config.discord.webhookUrl, messageId)
  }
  await db
    .update(clip)
    .set({ announced_at: null, announce_message_id: null })
    .where(eq(clip.id, clipId))
}
