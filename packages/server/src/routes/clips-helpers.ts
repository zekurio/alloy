import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_AUDIO_TRACK_KINDS,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TAG_MAX_LENGTH,
  CLIP_TAGS_MAX,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
import {
  CLIP_AUDIO_TRACK_LABEL_MAX_LENGTH,
  CLIP_AUDIO_TRACKS_MAX,
} from "@alloy/contracts/content"
import { t } from "@alloy/contracts/schema"
import { user } from "@alloy/db/auth-schema"
import { clip, CLIP_PRIVACY } from "@alloy/db/schema"
import { toPublicClipRow } from "@alloy/server/clips/select"
import {
  resolveTrimRange,
  TRIM_MIN_RANGE_MS,
} from "@alloy/server/clips/trim-range"
import { requiredSql } from "@alloy/server/db/sql"
import { isoDate } from "@alloy/server/runtime/date"
import { and, desc, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm"

import {
  cursorDate,
  cursorNonNegativeInteger,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import {
  optionalBlankToNullTrimmedString,
  requiredTrimmedString,
} from "./validation"

export const IdParam = t.object({ id: t.uuid() })

type ClipListSort = "top" | "recent"

type ClipListCursorPayload = {
  v: 1
  sort: ClipListSort
  /** Current key; falls back to the pre-publish-pipeline `createdAt` key. */
  publishedAt?: string
  createdAt?: string
  id: string
  viewCount?: number
  likeCount?: number
}

type ParsedClipListCursor = {
  publishedAt: Date
  id: string
  viewCount: number | null
  likeCount: number | null
}

type ClipListCursorRow = {
  id: string
  publishedAt: Date | string | null
  /** Pre-publish-moment fallback for rows that predate stamping. */
  createdAt: Date | string
  viewCount: number
  likeCount: number
}

type ClipListPageRow = ClipListCursorRow & {
  sourceKey: string | null
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  waveformKey: string | null
  durationMs: number | null
  width: number | null
  height: number | null
  thumbKey: string | null
  thumbBlurHash: string | null
  gameId: string | null
  game: string | null
}

// "unlisted" is link-only: it must never satisfy a listing/discovery filter.
export function publicClipPrivacyCondition(): SQL {
  return eq(clip.privacy, "public")
}

export function publicClipListingConditions(): SQL[] {
  return [
    eq(clip.status, "ready"),
    publicClipPrivacyCondition(),
    isNull(user.disabled_at),
  ]
}

export function parseClipListCursor(
  value: string | undefined,
  sort: ClipListSort,
): ParsedClipListCursor | null {
  if (!value) return null
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  const publishedAt = cursorDate(payload.publishedAt ?? payload.createdAt)
  const id = cursorRequiredString(payload.id)
  if (payload.v !== 1 || payload.sort !== sort || !publishedAt || !id) {
    return null
  }
  if (sort === "top") {
    const viewCount = cursorNonNegativeInteger(payload.viewCount)
    const likeCount = cursorNonNegativeInteger(payload.likeCount)
    if (viewCount === null || likeCount === null) return null
    return { publishedAt, id, viewCount, likeCount }
  }
  return { publishedAt, id, viewCount: null, likeCount: null }
}

function encodeClipListCursor(
  row: ClipListCursorRow,
  sort: ClipListSort,
): string {
  const payload: ClipListCursorPayload = {
    v: 1,
    sort,
    publishedAt: isoDate(row.publishedAt ?? row.createdAt),
    id: row.id,
    viewCount: sort === "top" ? row.viewCount : undefined,
    likeCount: sort === "top" ? row.likeCount : undefined,
  }
  return encodeCursorPayload(payload)
}

export function clipListCursorCondition(
  cursor: ParsedClipListCursor | null,
  sort: ClipListSort,
): SQL | null {
  if (!cursor) return null
  const afterPublishedAt = requiredSql(
    or(
      lt(clip.published_at, cursor.publishedAt),
      and(
        eq(clip.published_at, cursor.publishedAt),
        sql`${clip.id} > ${cursor.id}`,
      ),
    ),
    "clip cursor publishedAt",
  )

  if (sort === "top") {
    return requiredSql(
      or(
        lt(clip.view_count, cursor.viewCount ?? 0),
        and(
          eq(clip.view_count, cursor.viewCount ?? 0),
          or(
            lt(clip.like_count, cursor.likeCount ?? 0),
            and(eq(clip.like_count, cursor.likeCount ?? 0), afterPublishedAt),
          ),
        ),
      ),
      "top clips cursor",
    )
  }

  return afterPublishedAt
}

export function clipListOrderBy(sort: ClipListSort) {
  return sort === "top"
    ? [
        desc(clip.view_count),
        desc(clip.like_count),
        desc(clip.published_at),
        clip.id,
      ]
    : [desc(clip.published_at), clip.id]
}

export function clipListPage<T extends ClipListPageRow>(
  rows: T[],
  limit: number,
  sort: ClipListSort,
) {
  const pageRows = rows.slice(0, limit)
  const tail = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(toPublicClipRow),
    nextCursor:
      rows.length > limit && tail ? encodeClipListCursor(tail, sort) : null,
  }
}

// Raw tag input is sanitized/deduped/capped server-side via `normalizeTags`;
// this only bounds the request so an enormous array can't be sent. Each entry
// allows the leading `#` plus a little slack before sanitizing trims it.
const TagsInput = t
  .array(t.string().max(CLIP_TAG_MAX_LENGTH + 1))
  .max(CLIP_TAGS_MAX)
  .optional()

const AudioTracksInput = t
  .array(
    t.object({
      kind: t.enum(CLIP_AUDIO_TRACK_KINDS),
      label: t.string().trim().min(1).max(CLIP_AUDIO_TRACK_LABEL_MAX_LENGTH),
    }),
  )
  .max(CLIP_AUDIO_TRACKS_MAX)
  .optional()

export const InitiateBody = t
  .object({
    clientClipId: t.uuid().optional(),
    filename: t.string().min(1).max(255),
    contentType: t.enum(ACCEPTED_CLIP_CONTENT_TYPES),
    sizeBytes: t.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH),
    description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
    gameId: t.uuid().nullable().optional(),
    privacy: t.enum(CLIP_PRIVACY).$default("public"),
    mentionedUserIds: t.array(t.uuid()).optional(),
    tags: TagsInput,
    audioTracks: AudioTracksInput,
    width: t.number().int().positive().max(32_768).optional(),
    height: t.number().int().positive().max(32_768).optional(),
    durationMs: t.number().int().positive().optional(),
    // Kept source range: the raw upload is stored untouched and the media
    // run derives the cut, so trims ride along instead of being client-cut.
    trimStartMs: t.number().int().min(0).optional(),
    trimEndMs: t.number().int().positive().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.trimStartMs === undefined && body.trimEndMs === undefined) return
    if (body.trimStartMs === undefined || body.trimEndMs === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Trim requires both trimStartMs and trimEndMs",
        path: ["trimStartMs"],
      })
      return
    }
    if (body.durationMs === undefined) {
      if (body.trimEndMs - body.trimStartMs < TRIM_MIN_RANGE_MS) {
        ctx.addIssue({
          code: "custom",
          message: "The trimmed range is too short",
          path: ["trimEndMs"],
        })
      }
      return
    }
    const resolved = resolveTrimRange({
      startMs: body.trimStartMs,
      endMs: body.trimEndMs,
      durationMs: body.durationMs,
    })
    if (resolved.kind === "invalid") {
      ctx.addIssue({
        code: "custom",
        message: resolved.reason,
        path: ["trimEndMs"],
      })
    }
  })

export const PosterBody = t.object({
  timeMs: t.number().int().min(0),
})

export const TrimBody = t
  .object({
    startMs: t.number().int().min(0),
    endMs: t.number().int().positive(),
  })
  .refine((b) => b.endMs - b.startMs >= TRIM_MIN_RANGE_MS, {
    message: "The trimmed range is too short",
    path: ["endMs"],
  })

export const UpdateBody = t.object({
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH).optional(),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  gameId: t.uuid().nullable().optional(),
  privacy: t.enum(CLIP_PRIVACY).optional(),
  mentionedUserIds: t.array(t.uuid()).optional(),
  tags: TagsInput,
})

type PlaybackClipRow = typeof clip.$inferSelect

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "video/mp4":
      return "mp4"
    default:
      return "bin"
  }
}

export function contentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^A-Za-z0-9._-]+/g, "_")
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`
}

export function downloadFilename(row: PlaybackClipRow): string {
  const base = row.title.trim().replace(/[/\\?%*:|"<>]/g, "-") || row.id
  return `${base}.${extensionForContentType(row.source_content_type ?? "")}`
}
