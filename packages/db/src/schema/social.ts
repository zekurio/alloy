import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

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
  (t) => [
    uniqueIndex("block_pair_idx").on(t.blocker_id, t.blocked_id),
    // block_pair_idx leads with blocker_id, so lookups by the blocked user
    // need their own index.
    index("block_blocked_idx").on(t.blocked_id),
  ],
)
