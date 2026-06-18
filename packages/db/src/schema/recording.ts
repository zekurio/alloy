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
    id: uuid("id").primaryKey().defaultRandom(),
    // Owner anchors cascade cleanup when a user is deleted.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    targetType: text("target_type").$type<UploadTicketTarget>().notNull(),
    targetId: uuid("target_id").notNull(),
    role: text("role").$type<UploadTicketRole>().notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    uploadState: jsonb("upload_state").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("upload_ticket_target_idx").on(t.targetType, t.targetId),
    index("upload_ticket_owner_idx").on(t.ownerId),
    index("upload_ticket_expires_idx").on(t.expiresAt),
    index("upload_ticket_used_idx").on(t.usedAt),
    check(
      "upload_ticket_role_check",
      sql`${t.role} in (${sql.raw(sqlStringList(UPLOAD_TICKET_ROLE))})`,
    ),
    check(
      "upload_ticket_target_check",
      sql`${t.targetType} in (${sql.raw(sqlStringList(UPLOAD_TICKET_TARGET))})`,
    ),
    check(
      "upload_ticket_expected_bytes_safe_check",
      sql`${t.expectedBytes} > 0 and ${t.expectedBytes} <= 9007199254740991`,
    ),
  ],
)

export type UploadTicket = typeof uploadTicket.$inferSelect
