import {
  CLIP_PRIVACY,
  CLIP_STATUS,
  type ClipPrivacy,
  type ClipStatus,
  NOTIFICATION_TYPES,
  type NotificationType,
  type AdminScheduledTaskPayload,
  type AdminScheduledTaskResult,
  UPLOAD_TICKET_ROLE,
  type UploadTicketRole,
} from "alloy-contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth-schema"
import type { ClipEncodedVariant } from "./schema-types"

export { CLIP_PRIVACY, CLIP_STATUS, NOTIFICATION_TYPES, UPLOAD_TICKET_ROLE }
export type * from "./schema-types"

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")
}

export const game = pgTable(
  "game",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    steamgriddbId: integer("steamgriddb_id").notNull().unique(),
    name: text("name").notNull(),
    // URL-safe, unique. Dedupe happens on insert — if `slugify(name)`
    // collides with an existing row we append `-2`, `-3`, … and retry.
    slug: text("slug").notNull().unique(),
    releaseDate: timestamp("release_date"),
    heroUrl: text("hero_url"),
    // Vertical poster grid from SteamGridDB — used for game cards.
    gridUrl: text("grid_url"),
    // Transparent logo — overlaid on top of the hero on /g/:slug.
    // Nullable for the same reason.
    logoUrl: text("logo_url"),
    // Small square art for the home-feed chip bar.
    iconUrl: text("icon_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Lookup by name for the admin UI / debugging; the production read
    // path hits `steamgriddbId` (upsert) or `slug` (routes).
    index("game_name_idx").on(t.name),
  ],
)

export const clip = pgTable(
  "clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),
    game: text("game"),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "restrict" }),

    // One of `CLIP_PRIVACY`, validated via zod on write paths.
    privacy: text("privacy").$type<ClipPrivacy>().notNull().default("public"),

    sourceKey: text("source_key"),
    sourceContentType: text("source_content_type"),
    sourceVideoCodec: text("source_video_codec"),
    sourceAudioCodec: text("source_audio_codec"),
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
    openGraphKey: text("open_graph_key"),
    openGraphContentType: text("open_graph_content_type"),
    openGraphSizeBytes: bigint("open_graph_size_bytes", { mode: "number" }),
    // Nullable: populated by the finalize step after ffprobe. Clips in
    // 'pending' or 'failed' status may be missing some or all of these.
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),

    variants: jsonb("variants")
      .$type<ClipEncodedVariant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Server-generated on finalize. A thumbnail failure leaves this null
    // rather than failing the whole clip — the UI falls back to a placeholder.
    thumbKey: text("thumb_key"),

    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

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
    index("clip_author_idx").on(t.authorId),
    // Home feed hot path: "newest public (or public+unlisted) clips".
    // Filter on privacy, sort by createdAt — composite supports both.
    index("clip_privacy_created_idx").on(t.privacy, t.createdAt),
    // Top clips: only ready public/unlisted rows participate, so keep the
    // ranking columns first and in route order.
    index("clip_ready_visible_top_idx")
      .on(t.viewCount.desc(), t.likeCount.desc(), t.createdAt.desc(), t.id)
      .where(
        sql`${t.status} = 'ready' and ${t.privacy} in ('public', 'unlisted')`,
      ),
    index("clip_status_idx").on(t.status),
    index("clip_game_created_idx").on(t.gameId, t.createdAt),
    index("clip_ready_visible_game_top_idx")
      .on(
        t.gameId,
        t.viewCount.desc(),
        t.likeCount.desc(),
        t.createdAt.desc(),
        t.id,
      )
      .where(
        sql`${t.status} = 'ready' and ${t.privacy} in ('public', 'unlisted')`,
      ),
    check(
      "clip_privacy_check",
      sql`${t.privacy} in (${sql.raw(sqlStringList(CLIP_PRIVACY))})`,
    ),
    check(
      "clip_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(CLIP_STATUS))})`,
    ),
    check(
      "clip_source_size_bytes_safe_check",
      sql`${t.sourceSizeBytes} is null or (${t.sourceSizeBytes} >= 0 and ${t.sourceSizeBytes} <= 9007199254740991)`,
    ),
    check(
      "clip_open_graph_size_bytes_safe_check",
      sql`${t.openGraphSizeBytes} is null or (${t.openGraphSizeBytes} >= 0 and ${t.openGraphSizeBytes} <= 9007199254740991)`,
    ),
  ],
)

export const clipUploadTicket = pgTable(
  "clip_upload_ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    role: text("role").$type<UploadTicketRole>().notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("clip_upload_ticket_clip_idx").on(t.clipId),
    index("clip_upload_ticket_expires_idx").on(t.expiresAt),
    index("clip_upload_ticket_used_idx").on(t.usedAt),
    check(
      "clip_upload_ticket_role_check",
      sql`${t.role} in (${sql.raw(sqlStringList(UPLOAD_TICKET_ROLE))})`,
    ),
    check(
      "clip_upload_ticket_expected_bytes_safe_check",
      sql`${t.expectedBytes} > 0 and ${t.expectedBytes} <= 9007199254740991`,
    ),
  ],
)

export const clipLike = pgTable(
  "clip_like",
  {
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.userId] }),
    // Inverse lookup: "clips this user liked" for a future liked-feed.
    index("clip_like_user_idx").on(t.userId),
  ],
)

export const clipComment = pgTable(
  "clip_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    // Null = not pinned. At most one pinned per clip — enforced by a
    // partial unique index below plus a transaction on the pin route.
    pinnedAt: timestamp("pinned_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    editedAt: timestamp("edited_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "clip_comment_parent_fk",
    }).onDelete("cascade"),
    // Main read path: top-level comments for a clip ordered by createdAt,
    // then replies batched per top-level id.
    index("clip_comment_clip_created_idx").on(t.clipId, t.createdAt),
    index("clip_comment_parent_idx").on(t.parentId),
    // One pinned comment per clip. Partial index so non-pinned rows
    // don't conflict on the NULL.
    uniqueIndex("clip_comment_one_pin_per_clip_idx")
      .on(t.clipId)
      .where(sql`${t.pinnedAt} IS NOT NULL`),
  ],
)

export const clipCommentLike = pgTable(
  "clip_comment_like",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => clipComment.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId] }),
    // Reverse lookup: "did the clip author like this comment?" — the
    // list query joins on (commentId, clip.authorId).
    index("clip_comment_like_user_idx").on(t.userId),
  ],
)

export const clipMention = pgTable(
  "clip_mention",
  {
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.mentionedUserId] }),
    index("clip_mention_user_idx").on(t.mentionedUserId),
  ],
)

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

export const gameFollow = pgTable(
  "game_follow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_follow_pair_idx").on(t.userId, t.gameId),
    // Reverse lookup for the feed-ranking join ("is this clip's game
    // followed by the viewer?"), and for per-game follower counts.
    index("game_follow_game_idx").on(t.gameId),
  ],
)

export const clipView = pgTable(
  "clip_view",
  {
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    // Populated only for signed-in viewers. The chip-ordering query
    // needs this to join on user id without parsing `viewerKey`.
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.viewerKey] }),
    // Chip bar: "games the viewer has watched clips in".
    index("clip_view_user_clip_idx").on(t.userId, t.clipId),
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

export const scheduledTaskRun = pgTable(
  "scheduled_task_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: text("task_id").notNull(),
    trigger: text("trigger").$type<"startup" | "cron" | "manual">().notNull(),
    status: text("status")
      .$type<"running" | "success" | "failed" | "cancelled">()
      .notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    payload: jsonb("payload").$type<AdminScheduledTaskPayload | null>(),
    result: jsonb("result").$type<AdminScheduledTaskResult | null>(),
    error: text("error"),
  },
  (t) => [
    index("scheduled_task_run_task_started_idx").on(t.taskId, t.startedAt),
    index("scheduled_task_run_status_idx").on(t.status),
    check(
      "scheduled_task_run_trigger_check",
      sql`${t.trigger} in ('startup', 'cron', 'manual')`,
    ),
    check(
      "scheduled_task_run_status_check",
      sql`${t.status} in ('running', 'success', 'failed', 'cancelled')`,
    ),
    check(
      "scheduled_task_run_duration_ms_check",
      sql`${t.durationMs} is null or ${t.durationMs} >= 0`,
    ),
  ],
)

export const scheduledTaskLock = pgTable("scheduled_task_lock", {
  taskId: text("task_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  runId: uuid("run_id").notNull(),
  heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const domainSchema = {
  game,
  clip,
  clipUploadTicket,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  follow,
  gameFollow,
  block,
  notification,
  scheduledTaskRun,
  scheduledTaskLock,
} as const
