import { sql } from "drizzle-orm"
import {
  bigint,
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

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

export interface ClipVariantSettings {
  codec: string
  audioCodec: "aac"
  quality: number
  preset: string
  audioBitrateKbps: number
  height: number
  trimStartMs: number | null
  trimEndMs: number | null
}

export interface ClipEncodedVariant {
  id: string
  label: string
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
  /**
   * Optional because rows written before this field existed don't have
   * it. Missing settings are treated as "unknown → re-encode".
   */
  settings?: ClipVariantSettings
}

export const CLIP_STATUS = [
  "pending",
  "uploaded",
  "encoding",
  "ready",
  "failed",
] as const
export type ClipStatus = (typeof CLIP_STATUS)[number]

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
  ]
)

export const clip = pgTable(
  "clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),
    game: text("game"),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "restrict" }),

    // One of `CLIP_PRIVACY`. Stored as text (matching better-auth's `role`
    // convention) and validated via zod on write paths.
    privacy: text("privacy").$type<ClipPrivacy>().notNull().default("public"),

    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    // Nullable: populated by the finalize step after ffprobe. Clips in
    // 'pending' or 'failed' status may be missing some or all of these.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),

    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),

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
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("clip_author_idx").on(t.authorId),
    // Home feed hot path: "newest public (or public+unlisted) clips".
    // Filter on privacy, sort by createdAt — composite supports both.
    index("clip_privacy_created_idx").on(t.privacy, t.createdAt),
    index("clip_status_idx").on(t.status),
    index("clip_game_created_idx").on(t.gameId, t.createdAt),
  ]
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
  ]
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
  ]
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
  ]
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
  ]
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
  (t) => [uniqueIndex("follow_pair_idx").on(t.followerId, t.followingId)]
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
  ]
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
  ]
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
  (t) => [uniqueIndex("block_pair_idx").on(t.blockerId, t.blockedId)]
)

export const domainSchema = {
  game,
  clip,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  follow,
  gameFollow,
  block,
} as const

export type Game = typeof game.$inferSelect
export type NewGame = typeof game.$inferInsert
export type Clip = typeof clip.$inferSelect
export type NewClip = typeof clip.$inferInsert
export type ClipLike = typeof clipLike.$inferSelect
export type ClipView = typeof clipView.$inferSelect
export type NewClipView = typeof clipView.$inferInsert
export type ClipComment = typeof clipComment.$inferSelect
export type NewClipComment = typeof clipComment.$inferInsert
export type ClipCommentLike = typeof clipCommentLike.$inferSelect
export type NewClipCommentLike = typeof clipCommentLike.$inferInsert
export type ClipMention = typeof clipMention.$inferSelect
export type Follow = typeof follow.$inferSelect
export type NewFollow = typeof follow.$inferInsert
export type GameFollow = typeof gameFollow.$inferSelect
export type NewGameFollow = typeof gameFollow.$inferInsert
export type Block = typeof block.$inferSelect
export type NewBlock = typeof block.$inferInsert
