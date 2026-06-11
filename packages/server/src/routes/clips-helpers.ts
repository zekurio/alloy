import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TAG_MAX_LENGTH,
  CLIP_TAGS_MAX,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
import { clip, CLIP_PRIVACY } from "@alloy/db/schema"
import { toPublicClipRow } from "@alloy/server/clips/select"
import { requiredSql } from "@alloy/server/db/sql"
import { isoDate } from "@alloy/server/runtime/date"
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm"
import { z } from "zod"

import {
  cursorDate,
  cursorNonNegativeInteger,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import {
  limitQueryParam,
  optionalBlankToNullTrimmedString,
  optionalTrimmedString,
  requiredTrimmedString,
} from "./validation"

export const IdParam = z.object({ id: z.uuid() })
export const StreamQuery = z.object({
  variant: optionalTrimmedString(),
})
export const HlsFileParam = z.object({
  id: z.uuid(),
  file: z.string().min(1).max(64),
})
export const DownloadQuery = z.object({
  variant: optionalTrimmedString(),
})

export const ListQuery = z.object({
  window: z.enum(["today", "week", "month", "year", "all"]).optional(),
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: limitQueryParam(100, 50),
  cursor: z.string().optional(),
})

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
  steamgriddbId: number
  game: string | null
}

export function publicClipPrivacyCondition(): SQL {
  return eq(clip.privacy, "public")
}

export function shareableClipPrivacyCondition(): SQL {
  return inArray(clip.privacy, ["public", "unlisted"])
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
  if (!cursor.id) return lt(clip.createdAt, cursor.createdAt)

  const afterCreatedAt = requiredSql(
    or(
      lt(clip.createdAt, cursor.createdAt),
      and(eq(clip.createdAt, cursor.createdAt), sql`${clip.id} > ${cursor.id}`),
    ),
    "clip cursor createdAt",
  )

  if (sort === "top") {
    return requiredSql(
      or(
        lt(clip.viewCount, cursor.viewCount ?? 0),
        and(
          eq(clip.viewCount, cursor.viewCount ?? 0),
          or(
            lt(clip.likeCount, cursor.likeCount ?? 0),
            and(eq(clip.likeCount, cursor.likeCount ?? 0), afterCreatedAt),
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
        desc(clip.viewCount),
        desc(clip.likeCount),
        desc(clip.createdAt),
        clip.id,
      ]
    : [desc(clip.createdAt), clip.id]
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

// Epoch offsets for the window filter. Kept in one place so both the feed
// read and any future analytics rollups agree on what "today" means.
export const WINDOW_MS: Record<"today" | "week" | "month" | "year", number> = {
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
}

// BlurHash strings are base83: 6..~100 chars depending on component count.
const BLURHASH_PATTERN = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,120}$/

// Raw tag input is sanitized/deduped/capped server-side via `normalizeTags`;
// this only bounds the request so an enormous array can't be sent. Each entry
// allows the leading `#` plus a little slack before sanitizing trims it.
const TagsInput = z
  .array(z.string().max(CLIP_TAG_MAX_LENGTH + 1))
  .max(CLIP_TAGS_MAX)
  .optional()

export const InitiateBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ACCEPTED_CLIP_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  steamgriddbId: z.number().int().positive(),
  privacy: z.enum(CLIP_PRIVACY).default("public"),
  mentionedUserIds: z.array(z.uuid()).optional(),
  tags: TagsInput,
  thumbBlurHash: z.string().regex(BLURHASH_PATTERN).optional(),
})

/** Smallest media range a trim may keep, in ms. */
export const TRIM_MIN_RANGE_MS = 1000

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
  steamgriddbId: z.number().int().positive().optional(),
  privacy: z.enum(CLIP_PRIVACY).optional(),
  mentionedUserIds: z.array(z.uuid()).optional(),
  tags: TagsInput,
})

/** Parse an HTTP `Range: bytes=A-B` header into inclusive byte offsets. */
export function parseRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const startStr = match[1] ?? ""
  const endStr = match[2] ?? ""
  let start: number
  let end: number
  if (startStr === "" && endStr !== "") {
    const suffix = Number.parseInt(endStr, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else if (startStr !== "") {
    start = Number.parseInt(startStr, 10)
    end = endStr ? Number.parseInt(endStr, 10) : size - 1
  } else {
    return null
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= size ||
    start > end
  ) {
    return null
  }
  return { start, end }
}

type PlaybackClipRow = typeof clip.$inferSelect

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "video/mp4":
      return "mp4"
    case "video/quicktime":
      return "mov"
    case "video/x-matroska":
      return "mkv"
    case "video/webm":
      return "webm"
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

export function downloadFilename(
  row: PlaybackClipRow,
  variant: "source",
): string {
  const base = row.title.trim().replace(/[/\\?%*:|"<>]/g, "-") || row.id
  return `${base}-${variant}.${extensionForContentType(
    row.sourceContentType ?? "",
  )}`
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
