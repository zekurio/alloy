import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clipStatusDocument,
  formatStatCount,
  type StatusClip,
} from "./status-document"

const ORIGIN = "https://clips.example.com"
const CLIP_ID = "0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9"
const STATUS_ID = "15271826189086941860723332107912866041"

function statusClip(overrides: Partial<StatusClip> = {}): StatusClip {
  return {
    id: CLIP_ID,
    title: "Insane 1v5 clutch",
    description: null,
    gameName: "Counter-Strike 2",
    createdAt: new Date("2026-07-27T12:00:00.000Z"),
    durationMs: 30_000,
    width: 1920,
    height: 1080,
    thumbKey: "thumbs/abc",
    thumbBlurHash: "LEHV6nWB2yk8",
    sourceKey: "sources/abc",
    sourceContentType: "video/mp4",
    sourceCodecs: "avc1.640028,mp4a.40.2",
    cutKey: null,
    viewCount: 1234,
    likeCount: 34,
    commentCount: 5,
    renditionRows: [
      {
        name: "1080p",
        og: false,
        height: 1080,
        width: 1920,
        key: "renditions/1080",
        codecs: "avc1.640028,mp4a.40.2",
      },
      {
        name: "720p",
        og: true,
        height: 720,
        width: 1280,
        key: "renditions/720",
        codecs: "avc1.64001f,mp4a.40.2",
      },
    ],
    author: {
      id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      username: "zekurio",
      displayName: null,
      image: "/api/assets/users/avatar.png?v=abc",
      banner: null,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    ...overrides,
  }
}

test("status id is the digits-only encoding of the clip uuid", () => {
  const doc = clipStatusDocument(statusClip(), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.equal(doc?.id, STATUS_ID)
  assert.match(doc?.id ?? "", /^\d+$/)
})

test("account falls back to the username when no display name is set", () => {
  const doc = clipStatusDocument(statusClip(), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.equal(doc?.account.display_name, "zekurio")
  assert.equal(doc?.account.username, "zekurio")
  assert.equal(doc?.account.acct, "zekurio")
  assert.equal(doc?.account.url, `${ORIGIN}/u/zekurio`)
})

test("a display name is preferred over the username", () => {
  const doc = clipStatusDocument(
    statusClip({
      author: { ...statusClip().author, displayName: "Michael" },
    }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.equal(doc?.account.display_name, "Michael")
  assert.equal(doc?.account.acct, "zekurio")
})

test("a blank display name falls back rather than rendering empty", () => {
  const doc = clipStatusDocument(
    statusClip({ author: { ...statusClip().author, displayName: "   " } }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.equal(doc?.account.display_name, "zekurio")
})

test("avatar paths are resolved against the public origin", () => {
  const doc = clipStatusDocument(statusClip(), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.equal(
    doc?.account.avatar,
    `${ORIGIN}/api/assets/users/avatar.png?v=abc`,
  )
  assert.equal(doc?.account.header, null)
})

test("content carries the title, game and stats", () => {
  const doc = clipStatusDocument(statusClip(), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.equal(
    doc?.content,
    "<p><b>Insane 1v5 clutch</b></p><p>Counter-Strike 2</p>" +
      "<p>👁️ 1.2K&ensp;❤️ 34&ensp;💬 5</p>",
  )
})

test("a description is included above the game line", () => {
  const doc = clipStatusDocument(statusClip({ description: "one\ntwo" }), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.equal(
    doc?.content,
    "<p><b>Insane 1v5 clutch</b></p><p>one<br>two</p>" +
      "<p>Counter-Strike 2</p><p>👁️ 1.2K&ensp;❤️ 34&ensp;💬 5</p>",
  )
})

test("zero counts are dropped from the stats line", () => {
  const doc = clipStatusDocument(
    statusClip({ viewCount: 7, likeCount: 0, commentCount: 0 }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.equal(
    doc?.content,
    "<p><b>Insane 1v5 clutch</b></p><p>Counter-Strike 2</p><p>👁️ 7</p>",
  )
})

test("a clip with no engagement omits the stats paragraph entirely", () => {
  const doc = clipStatusDocument(
    statusClip({ viewCount: 0, likeCount: 0, commentCount: 0 }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.equal(
    doc?.content,
    "<p><b>Insane 1v5 clutch</b></p><p>Counter-Strike 2</p>",
  )
})

test("titles and descriptions are html escaped", () => {
  const doc = clipStatusDocument(
    statusClip({ title: "<script>alert(1)</script>", viewCount: 0 }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.match(doc?.content ?? "", /&lt;script&gt;/)
  assert.doesNotMatch(doc?.content ?? "", /<script>/)
})

test("the og-flagged rendition is embedded, not the source", () => {
  const doc = clipStatusDocument(statusClip(), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  const media = doc?.media_attachments[0]
  assert.equal(media?.type, "video")
  // 720p is the og-flagged tier; 1080p and the source are both bigger.
  assert.match(media?.url ?? "", /\/rendition\/720p\/file\.mp4\?v=/)
  assert.equal(media?.meta.original.width, 1280)
  assert.equal(media?.meta.original.size, "1280x720")
  assert.match(
    media?.preview_url ?? "",
    new RegExp(`^${ORIGIN}/api/clips/${CLIP_ID}/thumbnail\\?v=`),
  )
  assert.equal(media?.blurhash, "LEHV6nWB2yk8")
})

test("a clip with no usable rendition falls back to the source file", () => {
  const doc = clipStatusDocument(statusClip({ renditionRows: [] }), {
    origin: ORIGIN,
    siteName: "alloy",
  })
  assert.match(doc?.media_attachments[0]?.url ?? "", /\/source\/file/)
})

test("a clip with no embeddable media has no attachments", () => {
  const doc = clipStatusDocument(
    statusClip({
      renditionRows: [],
      sourceKey: null,
      cutKey: null,
      sourceContentType: null,
      sourceCodecs: null,
    }),
    { origin: ORIGIN, siteName: "alloy" },
  )
  assert.deepEqual(doc?.media_attachments, [])
})

test("formatStatCount truncates rather than rounding up", () => {
  assert.equal(formatStatCount(0), "0")
  assert.equal(formatStatCount(999), "999")
  assert.equal(formatStatCount(1_000), "1K")
  assert.equal(formatStatCount(1_299), "1.2K")
  assert.equal(formatStatCount(45_300), "45.3K")
  assert.equal(formatStatCount(2_100_000), "2.1M")
  assert.equal(formatStatCount(3_000_000_000), "3B")
})
