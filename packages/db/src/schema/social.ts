import { NOTIFICATION_TYPES, type NotificationType } from "alloy-contracts"
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

export { NOTIFICATION_TYPES }

export const follow = pgTable(
  "follow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followingId: uuid("following_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("follow_pair_idx").on(t.followerId, t.followingId),
    index("follow_following_idx").on(t.followingId),
  ],
)

export const block = pgTable(
  "block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("block_pair_idx").on(t.blockerId, t.blockedId)],
)

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<NotificationType>().notNull(),
    clipId: uuid("clip_id").references(() => clip.id, {
      onDelete: "cascade",
    }),
    commentId: uuid("comment_id").references(() => clipComment.id, {
      onDelete: "cascade",
    }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notification_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("notification_recipient_unread_idx")
      .on(t.recipientId, t.createdAt)
      .where(sql`${t.readAt} IS NULL`),
    check(
      "notification_type_check",
      sql`${t.type} in (${sql.raw(sqlStringList(NOTIFICATION_TYPES))})`,
    ),
  ],
)

export type Follow = typeof follow.$inferSelect
export type NewFollow = typeof follow.$inferInsert
export type Block = typeof block.$inferSelect
export type NewBlock = typeof block.$inferInsert
export type Notification = typeof notification.$inferSelect
export type NewNotification = typeof notification.$inferInsert
