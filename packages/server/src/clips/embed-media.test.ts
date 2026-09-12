import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { embedVideo, type EmbedMediaClip } from "./embed-media"

test("embeds select the declared OG tier or a verified playable source", () => {
  const row: EmbedMediaClip = {
    id: "clip-id",
    width: 1920,
    height: 1080,
    thumbKey: null,
    sourceKey: "source-key",
    sourceContentType: "video/mp4",
    sourceCodecs: "av01.0.08M.08,mp4a.40.2",
    cutKey: null,
    cutCodecs: null,
    renditionRows: [
      {
        name: "1080p",
        og: false,
        width: 1920,
        height: 1080,
        key: "rendition-key",
        codecs: "av01.0.08M.08,mp4a.40.2",
      },
    ],
  }
  const origin = "https://alloy.example"
  assert.equal(embedVideo(row, origin), null)
  assert.match(
    embedVideo({ ...row, sourceCodecs: "avc1.64002a,mp4a.40.2" }, origin)!.url,
    /\/source\/file\?v=/,
  )
  assert.match(
    embedVideo(
      {
        ...row,
        renditionRows: row.renditionRows!.map((tier) => ({
          ...tier,
          og: true,
        })),
      },
      origin,
    )!.url,
    /\/rendition\/1080p\/file\.mp4\?v=/,
  )
})
