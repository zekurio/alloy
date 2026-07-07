import { NOTIFICATION_KINDS, type NotificationKind } from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"
import { clip, clipComment } from "./clip"
import { sqlStringList } from "./internal"

export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actor_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text().$type<NotificationKind>().notNull(),
    clip_id: uuid().references(() => clip.id, { onDelete: "cascade" }),
    comment_id: uuid().references(() => clipComment.id, {
      onDelete: "cascade",
    }),
    dedup_key: text(),
    read_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_recipient_created_idx").on(
      t.recipient_id,
      t.created_at,
    ),
    index("notification_recipient_unread_idx")
      .on(t.recipient_id)
      .where(sql`${t.read_at} is null`),
    uniqueIndex("notification_dedup_idx")
      .on(t.recipient_id, t.dedup_key)
      .where(sql`${t.dedup_key} is not null`),
    check(
      "notification_kind_check",
      sql`${t.kind} in (${sql.raw(sqlStringList(NOTIFICATION_KINDS))})`,
    ),
  ],
)

export type Notification = typeof notification.$inferSelect
