import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"

export const follow = pgTable(
  "follow",
  {
    id: uuid().primaryKey().defaultRandom(),
    follower_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    following_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("follow_pair_idx").on(t.follower_id, t.following_id),
    index("follow_following_idx").on(t.following_id),
  ],
)

export const block = pgTable(
  "block",
  {
    id: uuid().primaryKey().defaultRandom(),
    blocker_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blocked_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("block_pair_idx").on(t.blocker_id, t.blocked_id)],
)
