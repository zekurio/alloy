import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENTS,
  WEBHOOK_PROVIDERS,
  type WebhookDeliveryStatus,
  type WebhookEvent,
  type WebhookProvider,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { clip } from "./clip"
import { sqlStringList } from "./internal"

export const webhook = pgTable(
  "webhook",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    provider: text().$type<WebhookProvider>().notNull(),
    url: text().notNull(),
    // HMAC signing key for generic deliveries; null for Discord, whose URL
    // already carries its own token.
    secret: text(),
    enabled: boolean().notNull().default(true),
    last_delivery_at: timestamp({ withTimezone: true }),
    last_delivery_status: integer(),
    last_delivery_error: text(),
    consecutive_failures: integer().notNull().default(0),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_enabled_idx")
      .on(t.enabled)
      .where(sql`${t.enabled}`),
    check(
      "webhook_provider_check",
      sql`${t.provider} in (${sql.raw(sqlStringList(WEBHOOK_PROVIDERS))})`,
    ),
  ],
)

/**
 * The ledger of what has already been announced.
 *
 * A row is claimed before the HTTP call, and the unique dedup index is what
 * stops an author from re-announcing a clip by flipping its privacy back and
 * forth. Rows are never pruned: a missing row reads as "never sent", so
 * retention would silently re-open that hole.
 */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid().primaryKey().defaultRandom(),
    webhook_id: uuid()
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    // Nullable so the table can carry events that are not about a clip. When
    // set, deleting the clip drops the ledger row — the clip can never be
    // published again, so the dedup entry has nothing left to guard.
    clip_id: uuid().references(() => clip.id, { onDelete: "cascade" }),
    event: text().$type<WebhookEvent>().notNull(),
    dedup_key: text().notNull(),
    status: text().$type<WebhookDeliveryStatus>().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    response_status: integer(),
    error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    delivered_at: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webhook_delivery_dedup_idx").on(t.webhook_id, t.dedup_key),
    index("webhook_delivery_clip_idx").on(t.clip_id),
    check(
      "webhook_delivery_event_check",
      sql`${t.event} in (${sql.raw(sqlStringList(WEBHOOK_EVENTS))})`,
    ),
    check(
      "webhook_delivery_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(WEBHOOK_DELIVERY_STATUSES))})`,
    ),
  ],
)

export type Webhook = typeof webhook.$inferSelect
export type WebhookDeliveryRow = typeof webhookDelivery.$inferSelect
