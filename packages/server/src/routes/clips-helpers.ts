import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TAG_MAX_LENGTH,
  CLIP_TAGS_MAX,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
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
import { z } from "zod"

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

export const IdParam = z.object({ id: z.uuid() })

type ClipListSort = "top" | "recent"

type ClipListCursorPayload = {
  v: 1
  sort: ClipListSort
  createdAt: string
  id: string
  viewCount?: number
  likeCount?: number
}

type ParsedClipListCursor = {
  createdAt: Date
  id: string | null
  viewCount: number | null
  likeCount: number | null
}

type ClipListCursorRow = {
  id: string
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

function parseLegacyClipListCursor(value: string): ParsedClipListCursor | null {
  const createdAt = cursorDate(value)
  return createdAt
    ? { createdAt, id: null, viewCount: null, likeCount: null }
    : null
}

export function parseClipListCursor(
  value: string | undefined,
  sort: ClipListSort,
): ParsedClipListCursor | null {
  if (!value) return null
  const payload = decodeCursorPayload(value)
  if (!payload) return parseLegacyClipListCursor(value)
  const createdAt = cursorDate(payload.createdAt)
  const id = cursorRequiredString(payload.id)
  if (payload.v !== 1 || payload.sort !== sort || !createdAt || !id) {
    return null
  }
  if (sort === "top") {
    const viewCount = cursorNonNegativeInteger(payload.viewCount)
    const likeCount = cursorNonNegativeInteger(payload.likeCount)
    if (viewCount === null || likeCount === null) return null
    return { createdAt, id, viewCount, likeCount }
  }
  return { createdAt, id, viewCount: null, likeCount: null }
}

function encodeClipListCursor(
  row: ClipListCursorRow,
  sort: ClipListSort,
): string {
  const payload: ClipListCursorPayload = {
    v: 1,
    sort,
    createdAt: isoDate(row.createdAt),
    id: row.id,
    ...(sort === "top"
      ? { viewCount: row.viewCount, likeCount: row.likeCount }
      : {}),
  }
  return encodeCursorPayload(payload)
}

export function clipListCursorCondition(
  cursor: ParsedClipListCursor | null,
  sort: ClipListSort,
): SQL | null {
  if (!cursor) return null
  if (!cursor.id) return lt(clip.created_at, cursor.createdAt)

  const afterCreatedAt = requiredSql(
    or(
      lt(clip.created_at, cursor.createdAt),
      and(
        eq(clip.created_at, cursor.createdAt),
        sql`${clip.id} > ${cursor.id}`,
      ),
    ),
    "clip cursor createdAt",
  )

  if (sort === "top") {
    return requiredSql(
      or(
        lt(clip.view_count, cursor.viewCount ?? 0),
        and(
          eq(clip.view_count, cursor.viewCount ?? 0),
          or(
            lt(clip.like_count, cursor.likeCount ?? 0),
            and(eq(clip.like_count, cursor.likeCount ?? 0), afterCreatedAt),
          ),
        ),
      ),
      "top clips cursor",
    )
  }

  return afterCreatedAt
}

export function clipListOrderBy(sort: ClipListSort) {
  return sort === "top"
    ? [
        desc(clip.view_count),
        desc(clip.like_count),
        desc(clip.created_at),
        clip.id,
      ]
    : [desc(clip.created_at), clip.id]
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
const TagsInput = z
  .array(z.string().max(CLIP_TAG_MAX_LENGTH + 1))
  .max(CLIP_TAGS_MAX)
  .optional()

export const InitiateBody = z
  .object({
    clientClipId: z.uuid().optional(),
    filename: z.string().min(1).max(255),
    contentType: z.enum(ACCEPTED_CLIP_CONTENT_TYPES),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH),
    description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
    gameId: z.uuid().nullable().optional(),
    privacy: z.enum(CLIP_PRIVACY).default("public"),
    mentionedUserIds: z.array(z.uuid()).optional(),
    tags: TagsInput,
    width: z.number().int().positive().max(32_768).optional(),
    height: z.number().int().positive().max(32_768).optional(),
    durationMs: z.number().int().positive().optional(),
    // Kept source range: the raw upload is stored untouched and the media
    // run derives the cut, so trims ride along instead of being client-cut.
    trimStartMs: z.number().int().min(0).optional(),
    trimEndMs: z.number().int().positive().optional(),
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

export const PosterBody = z.object({
  timeMs: z.number().int().min(0),
})

export const TrimBody = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .refine((b) => b.endMs - b.startMs >= TRIM_MIN_RANGE_MS, {
    message: "The trimmed range is too short",
    path: ["endMs"],
  })

export const UpdateBody = z.object({
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH).optional(),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  gameId: z.uuid().nullable().optional(),
  privacy: z.enum(CLIP_PRIVACY).optional(),
  mentionedUserIds: z.array(z.uuid()).optional(),
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

export async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
