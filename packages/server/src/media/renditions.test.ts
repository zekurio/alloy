import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import type { TranscodingConfig } from "@alloy/contracts"
import { env } from "@alloy/server/env"

import { runFfmpeg } from "./ffmpeg"
import { probeMedia } from "./probe"
import {
  effectiveLadder,
  encodeRendition,
  mediaPlaylistStats,
  RENDITION_MEDIA_URI_PLACEHOLDER,
  renderMasterPlaylist,
  renderMediaPlaylist,
  SEGMENT_SECONDS,
} from "./renditions"

const FULL_CONFIG: TranscodingConfig = {
  enable1080p: true,
  enable720p: true,
  enable480p: true,
}

test("effectiveLadder produces the full ladder below a 1440p60 source", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 1440, fps: 60 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [1080, 720, 480],
  )
  // 60fps source: top tiers keep the source rate uncapped, 480p caps to 30.
  assert.equal(ladder[0]?.capFps, false)
  assert.equal(ladder[0]?.fps, 60)
  assert.equal(ladder[2]?.capFps, true)
  assert.equal(ladder[2]?.fps, 30)
})

test("effectiveLadder clamps to the source height without upscaling", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 900, fps: 30 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [900, 720, 480],
  )
})

test("effectiveLadder dedupes tiers that collapse to the same height", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 720, fps: 60 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [720, 480],
  )
  // The native 720p tier's rate targets win over the clamped 1080p tier.
  assert.equal(ladder[0]?.tier.height, 720)
})

test("effectiveLadder rounds odd source heights down to even", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 719, fps: 30 })
  assert.equal(ladder[0]?.height, 718)
})

test("effectiveLadder yields one compat tier for tiny sources", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 360, fps: 30 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [360],
  )
  assert.equal(ladder[0]?.tier.height, 480)
})

test("effectiveLadder respects disabled tiers", () => {
  const ladder = effectiveLadder(
    { enable1080p: false, enable720p: true, enable480p: false },
    { height: 1440, fps: 60 },
  )
  assert.deepEqual(
    ladder.map((step) => step.height),
    [720],
  )
})

test("effectiveLadder caps fps when the source rate is unknown", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 1080, fps: null })
  assert.ok(ladder.every((step) => step.capFps))
  assert.equal(ladder[0]?.fps, 60)
})

const SAMPLE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${RENDITION_MEDIA_URI_PLACEHOLDER}",BYTERANGE="1373@0"
#EXTINF:2.000000,
#EXT-X-BYTERANGE:420669@1373
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXTINF:2.000000,
#EXT-X-BYTERANGE:502091@422042
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXTINF:1.000000,
#EXT-X-BYTERANGE:255267@924133
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXT-X-ENDLIST
`

test("mediaPlaylistStats derives the peak segment bitrate", () => {
  const stats = mediaPlaylistStats(SAMPLE_PLAYLIST)
  assert.ok(stats)
  assert.equal(stats.segmentCount, 3)
  // The short tail segment carries the highest rate: 255267 bytes over 1s.
  assert.equal(stats.peakBitrate, 255267 * 8)
})

test("mediaPlaylistStats returns null without segments", () => {
  assert.equal(mediaPlaylistStats("#EXTM3U\n#EXT-X-ENDLIST\n"), null)
})

test("renderMediaPlaylist substitutes every URI occurrence", () => {
  const rendered = renderMediaPlaylist(SAMPLE_PLAYLIST, "file.mp4?v=abc")
  assert.ok(!rendered.includes(RENDITION_MEDIA_URI_PLACEHOLDER))
  assert.equal(rendered.match(/file\.mp4\?v=abc/g)?.length, 4)
  assert.ok(
    rendered.includes('#EXT-X-MAP:URI="file.mp4?v=abc",BYTERANGE="1373@0"'),
  )
})

test("renderMasterPlaylist orders tiers and omits empty CODECS", () => {
  const master = renderMasterPlaylist([
    {
      height: 480,
      width: 854,
      fps: 30,
      codecs: "",
      bandwidth: 1_500_000,
      playlistUrl: "rendition/480/index.m3u8?v=b",
    },
    {
      height: 1080,
      width: 1920,
      fps: 60,
      codecs: "avc1.64002a,mp4a.40.2",
      bandwidth: 8_000_000,
      playlistUrl: "rendition/1080/index.m3u8?v=a",
    },
  ])
  const lines = master.trim().split("\n")
  assert.equal(lines[0], "#EXTM3U")
  const streamInfIndex = lines.findIndex((line) =>
    line.startsWith("#EXT-X-STREAM-INF:"),
  )
  assert.ok(
    lines[streamInfIndex]?.includes(
      'BANDWIDTH=8000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2"',
    ),
  )
  assert.equal(lines[streamInfIndex + 1], "rendition/1080/index.m3u8?v=a")
  const lowTier = lines.find((line) => line.includes("RESOLUTION=854x480"))
  assert.ok(lowTier)
  assert.ok(!lowTier.includes("CODECS"))
})

const ffmpegAvailable =
  spawnSync(env.transcode.ffmpegPath, ["-version"], { stdio: "ignore" })
    .status === 0

test(
  "encodeRendition emits an aligned single-file fMP4 with byte-range playlist",
  { skip: !ffmpegAvailable && "ffmpeg not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-renditions-test-"))
    try {
      const sourcePath = join(workDir, "source.mp4")
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1280x720:rate=60:duration=5",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          sourcePath,
        ],
      })

      const ladder = effectiveLadder(FULL_CONFIG, { height: 720, fps: 60 })
      assert.deepEqual(
        ladder.map((step) => step.height),
        [720, 480],
      )

      const progress: number[] = []
      const encoded = await encodeRendition(
        sourcePath,
        join(workDir, "out-720p"),
        ladder[0]!,
        { durationMs: 5000, onProgress: (fraction) => progress.push(fraction) },
      )

      assert.equal(encoded.height, 720)
      assert.equal(encoded.width, 1280)
      assert.ok(encoded.codecs.startsWith("avc1."))
      assert.ok(encoded.bandwidth > 0)
      assert.ok(progress.length > 0)
      assert.ok(progress.every((fraction) => fraction >= 0 && fraction <= 1))

      // The stored playlist must reference only the placeholder.
      assert.ok(encoded.playlist.includes(RENDITION_MEDIA_URI_PLACEHOLDER))
      assert.ok(!encoded.playlist.includes("media.mp4"))

      // Byte ranges must tile the file exactly: init segment from offset 0,
      // then contiguous segments ending at the file size.
      const fileSize = (await stat(encoded.filePath)).size
      assert.equal(encoded.sizeBytes, fileSize)
      const mapMatch = encoded.playlist.match(/BYTERANGE="(\d+)@(\d+)"/)
      assert.ok(mapMatch)
      assert.equal(Number(mapMatch[2]), 0)
      let expectedOffset = Number(mapMatch[1])
      for (const match of encoded.playlist.matchAll(
        /#EXT-X-BYTERANGE:(\d+)@(\d+)/g,
      )) {
        assert.equal(Number(match[2]), expectedOffset)
        expectedOffset += Number(match[1])
      }
      assert.equal(expectedOffset, fileSize)

      // Segment durations must sum to the media duration on the 2s grid.
      const durations = [
        ...encoded.playlist.matchAll(/#EXTINF:([\d.]+),/g),
      ].map((match) => Number(match[1]))
      assert.ok(durations.length >= 2)
      const total = durations.reduce((sum, value) => sum + value, 0)
      assert.ok(Math.abs(total - 5) < 0.5)
      assert.ok(
        durations
          .slice(0, -1)
          .every((value) => Math.abs(value - SEGMENT_SECONDS) < 0.05),
      )

      // The single file itself is a probeable progressive MP4.
      const probed = await probeMedia(encoded.filePath)
      assert.equal(probed.videoCodec, "h264")
      assert.equal(probed.height, 720)
      assert.equal(probed.audioCodec, "aac")
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)
