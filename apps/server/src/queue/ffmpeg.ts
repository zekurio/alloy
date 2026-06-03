import { env } from "../env"
import { join } from "../runtime/path"
import {
  buildEncodeArgs,
  buildHlsArgs,
  buildRemuxArgs,
  type ResolvedEncoderConfig,
} from "./ffmpeg-args"
import { runWithProgress } from "./ffmpeg-process"

export {
  buildEncodeArgs,
  buildRemuxArgs,
  codecNameFor,
  HLS_SEGMENT_SECONDS,
  type ResolvedEncoderConfig,
} from "./ffmpeg-args"
export { probe } from "./ffmpeg-probe"

const HLS_MEDIA_FILENAME = "media.m4s"
const HLS_PLAYLIST_FILENAME = "playlist.m3u8"
const HLS_MASTER_FILENAME = "master.m3u8"

export interface HlsArtifacts {
  /** Local path to the single CMAF file (init segment + all fragments). */
  mediaPath: string
  /** Media playlist text; references the media file by bare relative name. */
  playlist: string
  /** The EXT-X-STREAM-INF attribute list ffmpeg computed (BANDWIDTH, CODECS,
   *  RESOLUTION). Stored per variant so the combined master can be assembled
   *  at serve time without re-deriving RFC 6381 codec strings by hand. */
  streamInf: string
}

interface EncodeJob {
  config: ResolvedEncoderConfig
  targetHeight: number
  durationMs: number
  onProgress: (pct: number) => void
  trimStartMs?: number | null
  trimEndMs?: number | null
  signal?: AbortSignal
}

/** Translate ffmpeg `-progress` output lines into a 0-99 percentage. */
function progressHandler(
  durationMs: number,
  onProgress: (pct: number) => void,
): (line: string) => void {
  return (line) => {
    const m = /^out_time_us=(-?\d+)/m.exec(line) ??
      /^out_time_ms=(-?\d+)/m.exec(line)
    if (!m) return
    const microseconds = Number.parseInt(m[1] ?? "0", 10)
    if (!Number.isFinite(microseconds) || microseconds < 0) return
    const ms = microseconds / 1000
    const pct = Math.min(99, Math.max(0, Math.floor((ms / durationMs) * 100)))
    onProgress(pct)
  }
}

export async function encode(
  srcPath: string,
  outPath: string,
  opts: EncodeJob,
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildEncodeArgs(srcPath, outPath, opts),
    progressHandler(opts.durationMs, opts.onProgress),
    { label: `encode ${opts.targetHeight}p`, signal: opts.signal },
  )
}

/**
 * Encode into a single-file CMAF rendition with a byte-range HLS playlist.
 * ffmpeg runs with `workDir` as its cwd so the playlists reference the media
 * file by bare name; the caller uploads `mediaPath` and persists the playlist.
 */
export async function encodeHls(
  srcPath: string,
  workDir: string,
  opts: EncodeJob,
): Promise<HlsArtifacts> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildHlsArgs(srcPath, {
      mediaFilename: HLS_MEDIA_FILENAME,
      playlistFilename: HLS_PLAYLIST_FILENAME,
      masterFilename: HLS_MASTER_FILENAME,
    }, opts),
    progressHandler(opts.durationMs, opts.onProgress),
    {
      label: `encode ${opts.targetHeight}p hls`,
      signal: opts.signal,
      cwd: workDir,
    },
  )

  const [playlist, master] = await Promise.all([
    Deno.readTextFile(join(workDir, HLS_PLAYLIST_FILENAME)),
    Deno.readTextFile(join(workDir, HLS_MASTER_FILENAME)),
  ])

  return {
    mediaPath: join(workDir, HLS_MEDIA_FILENAME),
    playlist,
    streamInf: parseStreamInf(master),
  }
}

/** Pull the attribute list off the single EXT-X-STREAM-INF line ffmpeg wrote
 *  into the per-rendition master playlist. */
function parseStreamInf(master: string): string {
  for (const line of master.split("\n")) {
    const prefix = "#EXT-X-STREAM-INF:"
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
  }
  throw new Error("ffmpeg HLS master playlist had no EXT-X-STREAM-INF line")
}

export async function remuxToMp4(
  srcPath: string,
  outPath: string,
  opts: {
    trimStartMs?: number | null
    trimEndMs?: number | null
    signal?: AbortSignal
  },
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildRemuxArgs(srcPath, outPath, opts),
    () => undefined,
    { label: "remux source", signal: opts.signal },
  )
}

export async function thumbnail(
  srcPath: string,
  outPath: string,
  opts: {
    atMs: number
    signal?: AbortSignal
  },
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    [
      "-hide_banner",
      "-y",
      "-ss",
      msToFfmpegTimestamp(opts.atMs),
      "-i",
      srcPath,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      outPath,
    ],
    () => undefined,
    { label: "thumbnail", signal: opts.signal },
  )
}

function msToFfmpegTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return (
    `${hours.toString().padStart(2, "0")}:` +
    `${minutes.toString().padStart(2, "0")}:` +
    `${seconds.toString().padStart(2, "0")}.` +
    `${millis.toString().padStart(3, "0")}`
  )
}
