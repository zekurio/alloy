import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { buildClipPublishedPayload } from "./payload"

test("announcements wait for the OG rendition even when the source is playable", () => {
  const announcedAt = new Date("2026-09-08T00:00:00Z")
  const row: Parameters<typeof buildClipPublishedPayload>[0] = {
    id: "435a35a2-4ad5-4c9e-b258-63e35c4d1aab",
    privacy: "public",
    title: "New clip",
    description: null,
    game: null,
    gameId: null,
    durationMs: 17000,
    width: 1920,
    height: 1080,
    sourceKey: "source.mp4",
    sourceContentType: "video/mp4",
    sourceCodecs: "avc1.64002A,mp4a.40.2",
    cutKey: null,
    cutCodecs: null,
    thumbKey: "thumbnail.jpg",
    createdAt: new Date("2026-09-07T20:14:04Z"),
    publishedAt: new Date("2026-09-07T20:14:21Z"),
    authorId: "author",
    authorUsername: "player",
    authorDisplayName: null,
    renditionRows: [],
  }

  assert.equal(
    buildClipPublishedPayload(
      row,
      "delivery",
      "https://alloy.example",
      announcedAt,
    ),
    null,
  )

  row.renditionRows.push({
    name: "1080p",
    og: false,
    fps: 60,
    height: 1080,
    width: 1920,
    key: "1080p.mp4",
    codecs: "avc1.64002A,mp4a.40.2",
  })
  assert.equal(
    buildClipPublishedPayload(
      row,
      "delivery",
      "https://alloy.example",
      announcedAt,
    ),
    null,
  )

  row.renditionRows.push({
    name: "720p",
    og: true,
    fps: 30,
    height: 720,
    width: 1280,
    key: "720p.mp4",
    codecs: "avc1.64002A,mp4a.40.2",
  })
  const payload = buildClipPublishedPayload(
    row,
    "delivery",
    "https://alloy.example",
    announcedAt,
  )
  assert.ok(payload)
  assert.equal(
    new URL(payload.clip.videoUrl!).pathname,
    `/api/clips/${row.id}/rendition/720p/file.mp4`,
  )
  assert.equal(payload.deliveryId, "delivery")
  assert.equal(
    new URL(payload.clip.url).searchParams.get("t"),
    String(announcedAt.getTime()),
  )
  assert.equal(
    buildClipPublishedPayload(
      row,
      "delivery",
      "https://alloy.example",
      announcedAt,
    )?.clip.url,
    payload.clip.url,
  )
  assert.notEqual(
    buildClipPublishedPayload(
      row,
      "reannouncement",
      "https://alloy.example",
      new Date(announcedAt.getTime() + 1000),
    )?.clip.url,
    payload.clip.url,
  )

  row.privacy = "unlisted"
  assert.equal(
    buildClipPublishedPayload(
      row,
      "delivery",
      "https://alloy.example",
      announcedAt,
    ),
    null,
  )
})
