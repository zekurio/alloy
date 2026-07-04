import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { isBlurHash } from "@alloy/contracts/blurhash"
import sharp from "sharp"

import { runFfmpeg } from "./ffmpeg"
import { extractPoster } from "./poster"
import { transcodeSettings } from "./transcode-settings"

const ffmpegAvailable =
  spawnSync(transcodeSettings().ffmpegPath, ["-version"], { stdio: "ignore" })
    .status === 0 &&
  spawnSync(transcodeSettings().ffprobePath, ["-version"], { stdio: "ignore" })
    .status === 0

test(
  "extractPoster skips a black lead-in and returns a resized JPEG with BlurHash",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-poster-test-"))
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
          "color=c=black:size=1920x1080:rate=30:duration=1.2",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1920x1080:rate=30:duration=1.8",
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
          "-map",
          "[v]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-movflags",
          "+faststart",
          sourcePath,
        ],
      })

      const poster = await extractPoster(sourcePath, workDir, {
        durationMs: 3000,
      })
      assert.ok(poster)
      assert.equal(poster.jpeg[0], 0xff)
      assert.equal(poster.jpeg[1], 0xd8)
      assert.equal(poster.jpeg[2], 0xff)
      assert.equal(isBlurHash(poster.blurHash), true)

      const metadata = await sharp(poster.jpeg).metadata()
      assert.equal(metadata.format, "jpeg")
      assert.ok((metadata.width ?? 0) <= 1280)

      const stats = await sharp(poster.jpeg).stats()
      assert.ok(stats.channels[0] && stats.channels[0].max > 20)
      assert.ok(stats.channels[1] && stats.channels[1].max > 20)
      assert.ok(stats.channels[2] && stats.channels[2].max > 20)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

test(
  "extractPoster handles grayscale decoded frames",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-poster-test-"))
    try {
      const sourcePath = join(workDir, "gray.mp4")
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30:duration=1",
          "-vf",
          "format=gray",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-movflags",
          "+faststart",
          sourcePath,
        ],
      })

      const poster = await extractPoster(sourcePath, workDir, {
        durationMs: 1000,
      })
      assert.ok(poster)
      assert.equal(poster.jpeg[0], 0xff)
      assert.equal(poster.jpeg[1], 0xd8)
      assert.equal(poster.jpeg[2], 0xff)
      assert.equal(isBlurHash(poster.blurHash), true)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

test(
  "extractPoster accepts an explicit uniform frame when allowed",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-poster-test-"))
    try {
      const sourcePath = join(workDir, "black-explicit.mp4")
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:size=640x360:rate=30:duration=1",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          sourcePath,
        ],
      })

      const poster = await extractPoster(sourcePath, workDir, {
        durationMs: 1000,
        atMs: 0,
        allowUniform: true,
      })
      assert.ok(poster)
      assert.equal(poster.jpeg[0], 0xff)
      assert.equal(poster.jpeg[1], 0xd8)
      assert.equal(poster.jpeg[2], 0xff)
      assert.equal(isBlurHash(poster.blurHash), true)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

test(
  "extractPoster returns null when every candidate is uniform",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-poster-test-"))
    try {
      const sourcePath = join(workDir, "black.mp4")
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:size=640x360:rate=30:duration=2",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          sourcePath,
        ],
      })

      assert.equal(
        await extractPoster(sourcePath, workDir, { durationMs: 2000 }),
        null,
      )
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)
