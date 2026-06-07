import { ENCODE_DIR } from "../runtime/dirs"
import { join } from "../runtime/path"
import type { LiveHlsSpec } from "./live-hls-cache"

const LIVE_HLS_DIR = join(ENCODE_DIR, "live")
const SEGMENT_LENGTH_SEC = 3

export function liveHlsRootDir(): string {
  return LIVE_HLS_DIR
}

export function liveHlsSegmentLengthSec(): number {
  return SEGMENT_LENGTH_SEC
}

export function liveHlsPaths(cacheKey: string): {
  dir: string
  sourcePath: string
  playlistPath: string
  initFilename: string
  initPath: string
  segmentPattern: string
} {
  const dir = join(LIVE_HLS_DIR, cacheKey)
  const initFilename = `${cacheKey}-init.mp4`
  return {
    dir,
    sourcePath: join(dir, "source"),
    playlistPath: join(dir, "stream.m3u8"),
    initFilename,
    initPath: join(dir, initFilename),
    segmentPattern: join(dir, `${cacheKey}%d.mp4`),
  }
}

export function liveHlsSegmentFilename(
  cacheKey: string,
  segmentIndex: number,
): string {
  return `${cacheKey}${segmentIndex}.mp4`
}

export function parseLiveHlsSegment(
  cacheKey: string,
  filename: string,
): { kind: "init" } | { kind: "segment"; index: number } | null {
  if (filename === `${cacheKey}-init.mp4`) return { kind: "init" }
  const match = new RegExp(`^${cacheKey}(\\d+)\\.mp4$`).exec(filename)
  if (!match) return null
  const index = Number.parseInt(match[1] ?? "", 10)
  if (!Number.isSafeInteger(index) || index < 0) return null
  return { kind: "segment", index }
}

export function buildLiveHlsMediaPlaylist(input: {
  spec: LiveHlsSpec
  durationMs: number
  querySuffix?: string
}): string {
  const segmentLengths = liveHlsSegmentLengths(input.durationMs)
  const targetDuration = Math.ceil(
    Math.max(...segmentLengths, SEGMENT_LENGTH_SEC),
  )
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI="${input.spec.cacheKey}-init.mp4${timedQuerySuffix(
      input.querySuffix,
      0,
    )}"`,
  ]
  let runtimeTicks = 0
  for (let i = 0; i < segmentLengths.length; i++) {
    const segmentTicks = secondsToTicks(segmentLengths[i] ?? SEGMENT_LENGTH_SEC)
    lines.push(
      `#EXTINF:${segmentLengths[i]?.toFixed(3) ?? SEGMENT_LENGTH_SEC},`,
    )
    lines.push(
      `${liveHlsSegmentFilename(input.spec.cacheKey, i)}${timedQuerySuffix(
        input.querySuffix,
        runtimeTicks,
      )}`,
    )
    runtimeTicks += segmentTicks
  }
  lines.push("#EXT-X-ENDLIST")
  return `${lines.join("\n")}\n`
}

export function liveHlsSegmentCount(durationMs: number): number {
  return liveHlsSegmentLengths(durationMs).length
}

function liveHlsSegmentLengths(durationMs: number): number[] {
  const durationSec = Math.max(0.001, durationMs / 1000)
  const whole = Math.floor(durationSec / SEGMENT_LENGTH_SEC)
  const remaining = durationSec - whole * SEGMENT_LENGTH_SEC
  const lengths = Array.from({ length: whole }, () => SEGMENT_LENGTH_SEC)
  if (remaining > 0.001 || lengths.length === 0)
    lengths.push(remaining || 0.001)
  return lengths
}

function timedQuerySuffix(
  baseQuerySuffix: string | undefined,
  runtimeTicks: number,
): string {
  const separator = baseQuerySuffix ? "&" : "?"
  return `${baseQuerySuffix ?? ""}${separator}runtimeTicks=${runtimeTicks}`
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10_000_000))
}
