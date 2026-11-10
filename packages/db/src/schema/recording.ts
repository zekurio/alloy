import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"

/**
 * Short-lived record of a staged source upload destination for a clip being
 * created. No FK to the clip table — cleanup is explicit (the delete/finalize
 * flows drop tickets by clip), and rows expire.
 */
export const uploadTicket = pgTable(
  "upload_ticket",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Owner anchors cascade cleanup when a user is deleted.
    owner_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The clip the upload belongs to.
    target_id: uuid().notNull(),
    storage_key: text().notNull().unique(),
    content_type: text().notNull(),
    expected_bytes: bigint({ mode: "number" }).notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    used_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("upload_ticket_target_idx").on(t.target_id),
    index("upload_ticket_owner_idx").on(t.owner_id),
    check(
      "upload_ticket_expected_bytes_safe_check",
      sql`${t.expected_bytes} > 0 and ${t.expected_bytes} <= 9007199254740991`,
    ),
  ],
)

export type UploadTicket = typeof uploadTicket.$inferSelect
