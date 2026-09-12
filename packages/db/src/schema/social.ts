import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { user } from "./auth"

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
