import {
  bigint,
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

import { user } from "./auth-schema"

// Domain tables live here. Better-auth tables are in `./auth-schema` and are
// picked up by drizzle-kit via `../drizzle.config.ts`.
//
// Auth configuration (OAuth providers, email/password toggle) is not stored
// in the database — it's driven by env vars and a JSON-backed runtime config
// file. See apps/server/src/env.ts and apps/server/src/lib/config-store.ts.

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

// Lifecycle of a clip row from reservation through playback. The row is
// created in `pending` by `/api/clips/initiate`, flips to `uploaded` once
// bytes land via `/api/clips/:id/finalize`, then the encode worker takes it
// through `encoding` → `ready` (or `failed` after exhausting retries). The
// reaper picks up stuck `pending` rows; the worker handles `uploaded` →
// `ready` and writes `failureReason` on terminal failure.
export const CLIP_STATUS = [
  "pending",
  "uploaded",
  "encoding",
  "ready",
  "failed",
] as const
export type ClipStatus = (typeof CLIP_STATUS)[number]

/**
 * A user-authored video clip.
 *
 * Rows are written in two phases so we own the id before bytes land:
 *   1. `POST /api/clips/initiate` inserts with `status = 'pending'` and hands
 *      back an upload ticket (pre-signed PUT for S3, or an HMAC'd server
 *      upload URL for the fs driver).
 *   2. After the upload, `POST /api/clips/:id/finalize` probes the file
 *      (duration/width/height), generates thumbnails, and flips to `'ready'`.
 *
 * A background reaper deletes `pending` rows older than ~1h along with any
 * bytes at their storage key — without it, an abandoned upload would leak
 * both a row and an object. `'failed'` is the terminal state the reaper
 * picks up when probing or thumbnailing errors out in a non-retryable way.
 *
 * Counters (`viewCount`, `likeCount`, `commentCount`) are denormalized caches
 * of the corresponding join tables. They're maintained transactionally by
 * the write endpoints so list views don't have to COUNT() per row.
 */
export const clip = pgTable(
  "clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Short unguessable handle used in /c/:slug. Distinct from `id` so
    // unlisted clips get a capability-style URL and so the id format can
    // change in the future without breaking share links.
    slug: text("slug").notNull().unique(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),
    // Free-text for v1; a future SteamGridDB integration promotes this to
    // an fk on a `game` table with cover art and app id.
    game: text("game"),

    // One of `CLIP_PRIVACY`. Stored as text (matching better-auth's `role`
    // convention) and validated via zod on write paths.
    privacy: text("privacy").notNull().default("public"),

    // Opaque key inside the configured storage driver (S3 object key or
    // filesystem path relative to STORAGE_FS_ROOT). Callers never see this
    // directly — URLs are derived via the driver so we can flip public ↔
    // proxied without touching rows.
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    // Nullable: populated by the finalize step after ffprobe. Clips in
    // 'pending' or 'failed' status may be missing some or all of these.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),

    // Optional trim window picked in the upload modal. Both columns are
    // either null (use the whole source) or both set (clip out the
    // [start, end) window during encode). The encoder applies
    // `-ss <trim_start_ms>` + `-t <trim_end_ms - trim_start_ms>` so the
    // output `durationMs` reflects the trimmed length, not the source.
    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),

    // Server-generated on finalize. A thumbnail failure leaves these null
    // rather than failing the whole clip — the UI falls back to a placeholder.
    thumbKey: text("thumb_key"),
    thumbSmallKey: text("thumb_small_key"),

    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

    status: text("status").notNull().default("pending"),
    // 0–100, written by the encode worker every ~2s so the upload-queue
    // modal can render a progress bar without joining `pgboss.job`. Stays at
    // 0 until the worker picks the clip up; jumps to 100 when status flips
    // to 'ready'.
    encodeProgress: integer("encode_progress").notNull().default(0),
    // Short human-readable string the worker writes when status flips to
    // 'failed'. Surfaced as the queue row's detail line so the user sees
    // *why* the encode died without digging through server logs.
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
  ]
)

/**
 * A user's like on a clip. Presence is the like — the composite primary key
 * makes duplicate inserts idempotent. `clip.likeCount` mirrors the row count
 * per clip and is maintained transactionally by the like endpoint.
 */
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

/**
 * Dedup ledger for view counting. One row per (clip, viewer) pair; the
 * stream endpoint upserts it. On insert we bump `clip.viewCount`; on conflict
 * we just refresh `lastAt`. `viewerKey` is `user.id` when signed in and a
 * random id from a signed anon cookie otherwise — a cookie-less bot never
 * counts.
 *
 * Rows get pruned on a 90-day window by a background task. The prune keeps
 * the table bounded and makes the counter mean "unique viewers in the last
 * 90 days" instead of "total requests" — closer to what users expect.
 */
export const clipView = pgTable(
  "clip_view",
  {
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    lastAt: timestamp("last_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.viewerKey] }),
    // For the prune cron's range scan.
    index("clip_view_last_at_idx").on(t.lastAt),
  ]
)

/**
 * Flat one-level comment tree. Top-level comments have `parentId = null`;
 * replies have `parentId` pointing at a top-level comment on the same clip.
 * The "depth ≤ 1" rule is policy (the parent itself must have a null
 * parentId) and lives in the comment route, not the DB — the column shape
 * alone can't express it.
 *
 * Cascade on parent delete so removing a top-level comment takes its replies
 * with it; cascade on clip delete drops the whole thread.
 */
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
    // Self-reference — has to be declared via `foreignKey()` in the table
    // callback because column-level `.references()` can't refer to the
    // table being defined.
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
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
  ]
)

/**
 * Mentions of other users who appear in the clip. Kept as a join table
 * rather than an array column so the inverse query ("clips I've been
 * tagged in") uses a btree index instead of a GIN.
 *
 * Distinct from comments: comment authors aren't "mentioned" — a mention
 * is the uploader tagging a co-star/teammate.
 */
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

/**
 * Follow edges — directional (A follows B ≠ B follows A). The unique index
 * on `(followerId, followingId)` is what makes the `onConflictDoNothing()`
 * upsert in `/api/users/:username/follow` idempotent. Both sides cascade so
 * deleting a user cleans up their follow graph without leaving orphans.
 */
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

/**
 * Block edges — also directional. Application policy (enforced in
 * `apps/server/src/routes/users.ts`) severs follows in both directions when
 * a block is created, and refuses new follows while a block exists either
 * way. The unique index keeps block-creates idempotent the same way follow
 * does.
 */
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

export type Clip = typeof clip.$inferSelect
export type NewClip = typeof clip.$inferInsert
export type ClipLike = typeof clipLike.$inferSelect
export type ClipView = typeof clipView.$inferSelect
export type ClipComment = typeof clipComment.$inferSelect
export type NewClipComment = typeof clipComment.$inferInsert
export type ClipMention = typeof clipMention.$inferSelect
export type Follow = typeof follow.$inferSelect
export type NewFollow = typeof follow.$inferInsert
export type Block = typeof block.$inferSelect
export type NewBlock = typeof block.$inferInsert

export { user, session, account, verification } from "./auth-schema"
