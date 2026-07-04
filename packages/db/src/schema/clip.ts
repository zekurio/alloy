import {
  CLIP_PRIVACY,
  CLIP_STATUS,
  ENCODE_STAGE,
  type ClipPrivacy,
  type ClipStatus,
  type EncodeStage,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
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
    id: uuid().primaryKey().defaultRandom(),

    author_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text().notNull(),
    description: text(),
    // Non-authoritative display snapshot of the game name. `game_id` is null
    // for desktop captures, unknown games, and low-confidence detector guesses.
    game: text(),
    game_id: uuid().references(() => game.id, {
      onDelete: "set null",
    }),

    // One of `CLIP_PRIVACY`, validated via zod on write paths.
    privacy: text().$type<ClipPrivacy>().notNull().default("public"),

    source_key: text(),
    source_content_type: text(),
    source_video_codec: text(),
    source_audio_codec: text(),
    // RFC 6381 codec parameter string of the stored source (e.g.
    // "avc1.64002a,mp4a.40.2") for canPlayType negotiation; null = not
    // probed yet (legacy rows, backfilled lazily).
    source_codecs: text(),
    source_size_bytes: bigint({ mode: "number" }),
    // Full duration of the stored source; `duration_ms` stays the effective
    // playback duration (equals the trim cut's duration for trimmed clips).
    source_duration_ms: integer(),
    // Rounded probe fps; 0 = probed but unknown; null = not yet probed.
    source_fps: integer(),
    // Nullable: populated by the finalize step after probing. Clips in
    // 'pending' or 'failed' status may be missing some or all of these.
    duration_ms: integer(),
    width: integer(),
    height: integer(),

    // Poster image. The desktop client uploads a rendered JPEG + BlurHash on
    // upload; media processing validates and publishes it. A missing thumbnail
    // leaves this null rather than failing the clip — the UI shows a placeholder.
    thumb_key: text(),
    thumb_blur_hash: text(),

    view_count: integer().notNull().default(0),
    like_count: integer().notNull().default(0),
    comment_count: integer().notNull().default(0),

    // Owner trim range in source-time ms. Virtual: the source is never
    // modified; the media pipeline derives a stream-copy cut + renditions from
    // this persisted range. Null = untrimmed.
    trim_start_ms: integer(),
    trim_end_ms: integer(),
    // Storage key of the derived stream-copy cut for trimmed clips; null =
    // untrimmed.
    cut_key: text(),

    status: text().$type<ClipStatus>().notNull().default("pending"),
    // Fingerprint of the media pipeline that committed the current renditions
    // (null = legacy/pre-fingerprint). The rendition backfill re-encodes clips
    // whose value differs from the running pipeline's.
    encode_pipeline: text(),
    // Canonical desired-state JSON stamped by commitReady; null = never
    // verified under the fingerprint model.
    encode_fingerprint: text(),
    // Desired state whose encode terminally failed; quarantines the clip from
    // sweeps until config changes or an operator retries.
    encode_failed_fingerprint: text(),
    encode_progress: integer().notNull().default(0),
    // Transient stage labels for the active encode run; cleared on commitReady/markFailed.
    encode_stage: text().$type<EncodeStage>(),
    encode_tier: text(),
    encode_tier_index: integer(),
    encode_tier_count: integer(),
    encode_run_id: uuid(),
    encode_locked_at: timestamp(),
    encode_attempt: integer().notNull().default(0),
    failure_reason: text(),

    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index("clip_author_idx").on(t.author_id),
    // Home feed hot path: "newest public (or public+unlisted) clips".
    // Filter on privacy, sort by createdAt — composite supports both.
    index("clip_privacy_created_idx").on(t.privacy, t.created_at),
    // Top clips are the same for every viewer: only ready public rows
    // participate, so keep the ranking columns first and in route order.
    index("clip_ready_visible_top_idx")
      .on(t.view_count.desc(), t.like_count.desc(), t.created_at.desc(), t.id)
      .where(sql`${t.status} = 'ready' and ${t.privacy} = 'public'`),
    index("clip_status_idx").on(t.status),
    index("clip_ready_fingerprint_idx")
      .on(t.id)
      .where(sql`${t.status} = 'ready' and ${t.source_key} is not null`),
    index("clip_game_created_idx").on(t.game_id, t.created_at),
    index("clip_ready_visible_game_top_idx")
      .on(
        t.game_id,
        t.view_count.desc(),
        t.like_count.desc(),
        t.created_at.desc(),
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
      "clip_encode_stage_check",
      sql`${t.encode_stage} is null or ${t.encode_stage} in (${sql.raw(sqlStringList(ENCODE_STAGE))})`,
    ),
    check(
      "clip_source_size_bytes_safe_check",
      sql`${t.source_size_bytes} is null or (${t.source_size_bytes} >= 0 and ${t.source_size_bytes} <= 9007199254740991)`,
    ),
  ],
)

// One row per encoded quality tier of a clip. Renditions are progressive
// MP4s (faststart) served via range requests. Rows for a clip are replaced
// atomically when a media run commits, so a clip either has its full ladder
// or none (legacy/pre-backfill).
export const clipRendition = pgTable(
  "clip_rendition",
  {
    id: uuid().primaryKey().defaultRandom(),
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    // Stable per-tier slug derived from height/fps/codec, e.g. "1080p60".
    name: text().notNull(),
    // Whether this rendition powers OpenGraph/social embeds for the clip.
    is_og: boolean().notNull().default(false),
    height: integer().notNull(),
    width: integer().notNull(),
    fps: integer().notNull(),
    storage_key: text().notNull(),
    // RFC 6381 codec string, e.g. "avc1.64002a,mp4a.40.2", for canPlayType
    // filtering and quality-label disambiguation.
    codecs: text().notNull(),
    size_bytes: bigint({ mode: "number" }).notNull(),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clip_rendition_clip_name_idx").on(t.clip_id, t.name),
    check(
      "clip_rendition_size_bytes_safe_check",
      sql`${t.size_bytes} >= 0 and ${t.size_bytes} <= 9007199254740991`,
    ),
    check("clip_rendition_height_check", sql`${t.height} > 0`),
  ],
)

export const clipLike = pgTable(
  "clip_like",
  {
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clip_id, t.user_id] }),
    // Inverse lookup: "clips this user liked" for a future liked-feed.
    index("clip_like_user_idx").on(t.user_id),
  ],
)

export const clipComment = pgTable(
  "clip_comment",
  {
    id: uuid().primaryKey().defaultRandom(),
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    author_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parent_id: uuid(),
    body: text().notNull(),
    like_count: integer().notNull().default(0),
    // Null = not pinned. At most one pinned per clip — enforced by a
    // partial unique index below plus a transaction on the pin route.
    pinned_at: timestamp(),
    created_at: timestamp().notNull().defaultNow(),
    edited_at: timestamp(),
  },
  (t) => [
    foreignKey({
      columns: [t.parent_id],
      foreignColumns: [t.id],
      name: "clip_comment_parent_fk",
    }).onDelete("cascade"),
    // Main read path: top-level comments for a clip ordered by createdAt,
    // then replies batched per top-level id.
    index("clip_comment_clip_created_idx").on(t.clip_id, t.created_at),
    index("clip_comment_parent_idx").on(t.parent_id),
    // One pinned comment per clip. Partial index so non-pinned rows
    // don't conflict on the NULL.
    uniqueIndex("clip_comment_one_pin_per_clip_idx")
      .on(t.clip_id)
      .where(sql`${t.pinned_at} IS NOT NULL`),
  ],
)

export const clipCommentLike = pgTable(
  "clip_comment_like",
  {
    comment_id: uuid()
      .notNull()
      .references(() => clipComment.id, { onDelete: "cascade" }),
    user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.comment_id, t.user_id] }),
    // Reverse lookup: "did the clip author like this comment?" — the
    // list query joins on (commentId, clip.authorId).
    index("clip_comment_like_user_idx").on(t.user_id),
  ],
)

export const clipMention = pgTable(
  "clip_mention",
  {
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    mentioned_user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.clip_id, t.mentioned_user_id] }),
    index("clip_mention_user_idx").on(t.mentioned_user_id),
  ],
)

export const clipTag = pgTable(
  "clip_tag",
  {
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    // Bare, lowercase-canonical hashtag (no leading '#').
    tag: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clip_id, t.tag] }),
    // Reverse lookup for the /tags/:tag page and the tag filter.
    index("clip_tag_tag_idx").on(t.tag),
  ],
)

export const clipView = pgTable(
  "clip_view",
  {
    clip_id: uuid()
      .notNull()
      .references(() => clip.id, { onDelete: "cascade" }),
    viewer_key: text().notNull(),
    // Populated only for signed-in viewers. The chip-ordering query
    // needs this to join on user id without parsing `viewerKey`.
    user_id: uuid().references(() => user.id, {
      onDelete: "set null",
    }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clip_id, t.viewer_key] }),
    // Chip bar: "games the viewer has watched clips in".
    index("clip_view_user_clip_idx").on(t.user_id, t.clip_id),
  ],
)

export type Clip = typeof clip.$inferSelect
export type ClipRendition = typeof clipRendition.$inferSelect
