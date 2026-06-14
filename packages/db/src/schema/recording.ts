import {
  CLIP_STATUS,
  type ClipStatus,
  RECORDING_KIND,
  type RecordingKind,
  UPLOAD_TICKET_ROLE,
  type UploadTicketRole,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"
import { gameSession, userDevice } from "./device"
import { game } from "./game"
import { sqlStringList } from "./internal"

export { RECORDING_KIND, UPLOAD_TICKET_ROLE }

/**
 * The kinds of media-bearing record an upload ticket / processing job can
 * target. Staged uploads and the media worker are recording-agnostic, so the
 * ticket table is polymorphic rather than FK'd to a single table.
 */
export const UPLOAD_TICKET_TARGET = ["clip", "staging"] as const
export type UploadTicketTarget = (typeof UPLOAD_TICKET_TARGET)[number]

/**
 * Short-lived record of a staged upload destination (video or poster) for a
 * recording being created. Polymorphic over {@link UPLOAD_TICKET_TARGET}: the
 * same staged-upload + media-processing machinery serves both published clips
 * and owner-only staging recordings. No FK to the target table — cleanup is
 * explicit (the delete/finalize flows drop tickets by target), and rows expire.
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

/**
 * An owner-only recording synced to the server but not yet published as a
 * clip. It carries the full media + processing column set (so it goes through
 * the same probe/trim/HLS pipeline as a clip and is playable/trimmable from
 * the owner's library on any device), but unlike `clip`:
 *  - the game is OPTIONAL (best-effort from desktop detection),
 *  - there is no privacy/engagement (it is always owner-only),
 *  - its id is not in the clip namespace and never appears in discovery.
 *
 * Publishing promotes a staging row into a `clip` in place, reusing the same
 * stored media (the prewarmed HLS package, keyed by source key, carries over).
 */
export const stagingRecording = pgTable(
  "staging_recording",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // clip = short replay/highlight, session = long full-length capture.
    kind: text("kind").$type<RecordingKind>().notNull().default("clip"),

    title: text("title").notNull(),
    description: text("description"),

    // Nullable: the whole point of staging is to sync without a resolved game.
    // `game` is a display snapshot of the (possibly unresolved) detected name.
    game: text("game"),
    steamgriddbId: integer("steamgriddb_id").references(
      () => game.steamgriddbId,
      { onDelete: "set null" },
    ),

    originDeviceId: uuid("origin_device_id").references(() => userDevice.id, {
      onDelete: "set null",
    }),
    gameSessionId: uuid("game_session_id").references(() => gameSession.id, {
      onDelete: "set null",
    }),

    sourceKey: text("source_key"),
    sourceContentType: text("source_content_type"),
    sourceVideoCodec: text("source_video_codec"),
    sourceAudioCodec: text("source_audio_codec"),
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),

    thumbKey: text("thumb_key"),
    thumbBlurHash: text("thumb_blur_hash"),

    // Bare, lowercase-canonical hashtags. Stored denormalized (no join table)
    // since staging is owner-only; expanded into clip_tag rows on publish.
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Pending owner-requested trim (source-time ms), same contract as clip.
    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),

    status: text("status").$type<ClipStatus>().notNull().default("pending"),
    encodeProgress: integer("encode_progress").notNull().default(0),
    encodeRunId: uuid("encode_run_id"),
    encodeLockedAt: timestamp("encode_locked_at"),
    encodeAttempt: integer("encode_attempt").notNull().default(0),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("staging_recording_author_idx").on(t.authorId),
    // Owner library: newest of a given kind for an author.
    index("staging_recording_author_kind_created_idx").on(
      t.authorId,
      t.kind,
      t.createdAt,
    ),
    index("staging_recording_status_idx").on(t.status),
    index("staging_recording_game_session_idx").on(t.gameSessionId),
    check(
      "staging_recording_kind_check",
      sql`${t.kind} in (${sql.raw(sqlStringList(RECORDING_KIND))})`,
    ),
    check(
      "staging_recording_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(CLIP_STATUS))})`,
    ),
    check(
      "staging_recording_source_size_bytes_safe_check",
      sql`${t.sourceSizeBytes} is null or (${t.sourceSizeBytes} >= 0 and ${t.sourceSizeBytes} <= 9007199254740991)`,
    ),
  ],
)

export type UploadTicket = typeof uploadTicket.$inferSelect
export type StagingRecording = typeof stagingRecording.$inferSelect
