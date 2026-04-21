import { Buffer } from "node:buffer"
import { Readable } from "node:stream"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { getAuth } from "../auth"
import {
  CLIP_PRIVACY,
  clip,
  type ClipEncodedVariant,
} from "@workspace/db/schema"

import { db } from "../db"
import { configStore } from "../lib/config-store"
import { clipAssetKey } from "../storage"

export const IdParam = z.object({ id: z.uuid() })
export const StreamQuery = z.object({ variant: z.string().min(1).optional() })
export const DownloadQuery = z.object({
  variant: z.string().min(1).default("source"),
})

export const ListQuery = z.object({
  window: z.enum(["today", "week", "month"]).optional(),
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.iso.datetime().optional(),
})

// Epoch offsets for the window filter. Kept in one place so both the feed
// read and any future analytics rollups agree on what "today" means.
export const WINDOW_MS: Record<"today" | "week" | "month", number> = {
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
}

export const ACCEPTED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
] as const

export const MAX_THUMB_BYTES = 2 * 1024 * 1024

// Short-window cache throttle — the `clip_view` PK does the real dedup,
// this just avoids one DB round-trip on refresh-spam within the TTL.
export const VIEW_THROTTLE_TTL_SEC = 60

export const InitiateBody = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.enum(ACCEPTED_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    title: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    gameId: z.uuid(),
    privacy: z.enum(CLIP_PRIVACY).default("public"),
    trimStartMs: z.number().int().min(0).optional(),
    trimEndMs: z.number().int().positive().optional(),
    thumbSizeBytes: z.number().int().positive().max(MAX_THUMB_BYTES),
    thumbSmallSizeBytes: z.number().int().positive().max(MAX_THUMB_BYTES),
    mentionedUserIds: z.array(z.uuid()).optional(),
  })
  .refine((b) => b.sizeBytes <= configStore.get("limits").maxUploadBytes, {
    message: "sizeBytes exceeds the configured maximum upload size",
    path: ["sizeBytes"],
  })
  .refine(
    (b) =>
      (b.trimStartMs == null && b.trimEndMs == null) ||
      (b.trimStartMs != null &&
        b.trimEndMs != null &&
        b.trimEndMs > b.trimStartMs),
    {
      message: "trimStartMs and trimEndMs must both be set with end > start",
      path: ["trimEndMs"],
    }
  )

export const UpdateBody = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  gameId: z.uuid().optional(),
  privacy: z.enum(CLIP_PRIVACY).optional(),
  mentionedUserIds: z.array(z.uuid()).optional(),
})

export async function peekViewer(
  headers: Headers
): Promise<{ id: string; role: string | null } | null> {
  const session = await getAuth().api.getSession({ headers })
  if (!session) return null
  return {
    id: session.user.id,
    role: (session.user as { role?: string | null }).role ?? null,
  }
}

export async function resolveEngagementTarget(
  id: string,
  headers: Headers
): Promise<
  | { likeCount: number; accessible: true }
  | { likeCount?: never; accessible: false; response: Response }
> {
  const [row] = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      status: clip.status,
      privacy: clip.privacy,
      likeCount: clip.likeCount,
    })
    .from(clip)
    .where(eq(clip.id, id))
    .limit(1)
  if (!row) {
    return {
      accessible: false,
      response: new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    }
  }

  if (row.status !== "ready") {
    return {
      accessible: false,
      response: new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    }
  }

  const viewer = await peekViewer(headers)
  const isOwner = viewer?.id === row.authorId
  const isAdmin = viewer?.role === "admin"
  if (row.privacy === "private" && !isOwner && !isAdmin) {
    return {
      accessible: false,
      response: new Response(
        JSON.stringify({ error: viewer ? "Forbidden" : "Unauthorized" }),
        {
          status: viewer ? 403 : 401,
          headers: { "Content-Type": "application/json" },
        }
      ),
    }
  }

  return { accessible: true, likeCount: row.likeCount }
}

/** Parse an HTTP `Range: bytes=A-B` header into inclusive byte offsets. */
export function parseRange(
  rangeHeader: string | undefined,
  size: number
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

export type PlaybackClipRow = typeof clip.$inferSelect

export function encodedVariantsForRow(
  row: PlaybackClipRow
): ClipEncodedVariant[] {
  if (row.variants.length > 0) {
    return row.variants
  }
  return [
    {
      id: "encoded",
      label: "Playback MP4",
      storageKey: clipAssetKey(row.id, "video"),
      contentType: "video/mp4",
      width: row.width ?? 0,
      height: row.height ?? 0,
      sizeBytes: row.sizeBytes ?? 0,
      isDefault: true,
    },
  ]
}

export function findEncodedVariant(
  row: PlaybackClipRow,
  variantId: string | undefined
): ClipEncodedVariant | null {
  const variants = encodedVariantsForRow(row)
  if (!variantId) {
    return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null
  }
  return variants.find((variant) => variant.id === variantId) ?? null
}

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
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function downloadFilename(
  row: PlaybackClipRow,
  variant: "source" | ClipEncodedVariant
): string {
  const base = row.title.trim().replace(/[/\\?%*:|"<>]/g, "-") || row.id
  if (variant === "source") {
    return `${base}-source.${extensionForContentType(row.contentType)}`
  }
  return `${base}-${variant.id}.${extensionForContentType(variant.contentType)}`
}

export function nodeToWeb(node: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(node) as ReadableStream<Uint8Array>
}

export async function readAll(node: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of node) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
