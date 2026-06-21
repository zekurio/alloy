import { UPLOAD_TICKET_ROLE, type UploadTicketRole } from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"
import { sqlStringList } from "./internal"

export { UPLOAD_TICKET_ROLE }

export const UPLOAD_TICKET_TARGET = ["clip"] as const
export type UploadTicketTarget = (typeof UPLOAD_TICKET_TARGET)[number]

/**
 * Short-lived record of a staged upload destination (video or poster) for a
 * clip being created. No FK to the clip table — cleanup is explicit (the
 * delete/finalize flows drop tickets by target), and rows expire.
 */
export const uploadTicket = pgTable(
  "upload_ticket",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Owner anchors cascade cleanup when a user is deleted.
    owner_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    target_type: text().$type<UploadTicketTarget>().notNull(),
    target_id: uuid().notNull(),
    role: text().$type<UploadTicketRole>().notNull(),
    storage_key: text().notNull().unique(),
    content_type: text().notNull(),
    expected_bytes: bigint({ mode: "number" }).notNull(),
    upload_state: jsonb().$type<Record<string, unknown> | null>(),
    expires_at: timestamp().notNull(),
    used_at: timestamp(),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index("upload_ticket_target_idx").on(t.target_type, t.target_id),
    index("upload_ticket_owner_idx").on(t.owner_id),
    index("upload_ticket_expires_idx").on(t.expires_at),
    index("upload_ticket_used_idx").on(t.used_at),
    check(
      "upload_ticket_role_check",
      sql`${t.role} in (${sql.raw(sqlStringList(UPLOAD_TICKET_ROLE))})`,
    ),
    check(
      "upload_ticket_target_check",
      sql`${t.target_type} in (${sql.raw(sqlStringList(UPLOAD_TICKET_TARGET))})`,
    ),
    check(
      "upload_ticket_expected_bytes_safe_check",
      sql`${t.expected_bytes} > 0 and ${t.expected_bytes} <= 9007199254740991`,
    ),
  ],
)

export type UploadTicket = typeof uploadTicket.$inferSelect
