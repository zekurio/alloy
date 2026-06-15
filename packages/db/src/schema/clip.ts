import {
  CLIP_PRIVACY,
  CLIP_STATUS,
  type ClipPrivacy,
  type ClipStatus,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"
import { game } from "./game"
import { sqlStringList } from "./internal"

export { CLIP_PRIVACY, CLIP_STATUS }

export const clip = pgTable(
  "clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),
    // Non-authoritative display snapshot. `steamgriddbId` is null for desktop
    // captures, unknown games, and low-confidence detector guesses.
    game: text("game"),
    steamgriddbId: integer("steamgriddb_id").references(
      () => game.steamgriddbId,
      {
        onDelete: "set null",
      },
    ),

    // One of `CLIP_PRIVACY`, validated via zod on write paths.
    privacy: text("privacy").$type<ClipPrivacy>().notNull().default("public"),

    sourceKey: text("source_key"),
    sourceContentType: text("source_content_type"),
    sourceVideoCodec: text("source_video_codec"),
    sourceAudioCodec: text("source_audio_codec"),
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
    // Nullable: populated by the finalize step after probing. Clips in
    // 'pending' or 'failed' status may be missing some or all of these.
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),

    // Poster image. The desktop client uploads a rendered webp + BlurHash on
    // upload; media processing publishes it as-is. A missing thumbnail leaves
    // this null rather than failing the clip — the UI shows a placeholder.
    thumbKey: text("thumb_key"),
    thumbBlurHash: text("thumb_blur_hash"),

    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

    // Pending owner-requested trim (source-time ms). The media pipeline cuts
    // the stored source to this range on its next run and clears both.
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
    index("clip_author_idx").on(t.authorId),
    // Home feed hot path: "newest public (or public+unlisted) clips".
    // Filter on privacy, sort by createdAt — composite supports both.
    index("clip_privacy_created_idx").on(t.privacy, t.createdAt),
    // Top clips are the same for every viewer: only ready public rows
    // participate, so keep the ranking columns first and in route order.
    index("clip_ready_visible_top_idx")
      .on(t.viewCount.desc(), t.likeCount.desc(), t.createdAt.desc(), t.id)
      .where(sql`${t.status} = 'ready' and ${t.privacy} = 'public'`),
    index("clip_status_idx").on(t.status),
    index("clip_steamgriddb_created_idx").on(t.steamgriddbId, t.createdAt),
    index("clip_ready_visible_steamgriddb_top_idx")
      .on(
        t.steamgriddbId,
        t.viewCount.desc(),
        t.likeCount.desc(),
        t.createdAt.desc(),
        t.id,
      )
      .where(sql`${t.status} = 'ready' and ${t.privacy} = 'public'`),
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

export const clipTag = pgTable(
  "clip_tag",
  {
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    // Bare, lowercase-canonical hashtag (no leading '#').
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.tag] }),
    // Reverse lookup for the /tags/:tag page and the tag filter.
    index("clip_tag_tag_idx").on(t.tag),
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

export type Clip = typeof clip.$inferSelect
