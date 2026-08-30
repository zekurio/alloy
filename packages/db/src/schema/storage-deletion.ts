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

import { sqlStringList } from "./internal"

export const STORAGE_DELETION_NAMESPACES = [
  "clips",
  "thumbnails",
  "assets",
] as const

export type StorageDeletionNamespace =
  (typeof STORAGE_DELETION_NAMESPACES)[number]

/**
 * Durable intent to remove one physical storage object.
 *
 * A row exists only while deletion is outstanding. The namespace/key pair is
 * the stable identity and makes producer retries idempotent; successful work
 * removes the row so completed deletions do not become an unbounded audit log.
 */
export const storageDeletion = pgTable(
  "storage_deletion",
  {
    id: uuid().primaryKey().defaultRandom(),
    namespace: text().$type<StorageDeletionNamespace>().notNull(),
    storage_key: text().notNull(),
    // Resumable-upload state can outlive the published object and needs an
    // explicit abort before the ordinary idempotent object delete.
    abort_upload: boolean().notNull().default(false),
    reason: text().notNull(),
    source_type: text().notNull(),
    source_id: text(),
    // Retries never become terminal. This persisted deadline is the source of
    // truth across process restarts; an in-memory wake only removes latency.
    next_attempt_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    // Producer upserts advance this fence. A worker may only complete or
    // defer the exact intent revision it inspected before the storage call.
    revision: integer().notNull().default(1),
    last_error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("storage_deletion_object_idx").on(t.namespace, t.storage_key),
    index("storage_deletion_next_attempt_idx").on(
      t.next_attempt_at,
      t.created_at,
    ),
    check(
      "storage_deletion_namespace_check",
      sql`${t.namespace} in (${sql.raw(sqlStringList(STORAGE_DELETION_NAMESPACES))})`,
    ),
    check("storage_deletion_attempts_check", sql`${t.attempts} >= 0`),
    check("storage_deletion_revision_check", sql`${t.revision} > 0`),
    check(
      "storage_deletion_key_check",
      sql`char_length(${t.storage_key}) between 1 and 2048 and ${t.storage_key} = lower(${t.storage_key})`,
    ),
    check(
      "storage_deletion_reason_check",
      sql`char_length(btrim(${t.reason})) between 1 and 500`,
    ),
    check(
      "storage_deletion_source_type_check",
      sql`char_length(btrim(${t.source_type})) between 1 and 100`,
    ),
    check(
      "storage_deletion_source_id_check",
      sql`${t.source_id} is null or char_length(btrim(${t.source_id})) between 1 and 500`,
    ),
  ],
)

export type StorageDeletion = typeof storageDeletion.$inferSelect
