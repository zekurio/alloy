import { test } from "node:test"

import { validateClipRow } from "./clips"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function clipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip-id",
    authorId: "author-id",
    title: "Clip",
    description: null,
    game: null,
    steamgriddbId: 42,
    privacy: "public",
    sourceContentType: "video/x-matroska",
    sourceVideoCodec: "hevc",
    sourceAudioCodec: "aac",
    sourceSizeBytes: 1024,
    durationMs: 1000,
    width: 1920,
    height: 1080,
    thumbKey: "thumbnail",
    thumbBlurHash: null,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    status: "ready",
    encodeProgress: 100,
    failureReason: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    authorUsername: "zekurio",
    authorImage: null,
    gameRef: null,
    tags: [],
    ...overrides,
  }
}

test("validateClipRow accepts source codec metadata", () => {
  const row = validateClipRow(clipRow())

  assert(row.sourceVideoCodec === "hevc", "video codec should be preserved")
  assert(row.sourceAudioCodec === "aac", "audio codec should be preserved")
})

test("validateClipRow requires nullable source codec metadata fields", () => {
  const { sourceVideoCodec: _sourceVideoCodec, ...row } = clipRow()

  try {
    validateClipRow(row)
  } catch {
    return
  }

  throw new Error("missing sourceVideoCodec should fail validation")
})
