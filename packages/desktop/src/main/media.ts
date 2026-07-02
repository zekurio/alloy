import {
  assertUploadMp4Compatible,
  type OutputSinks,
  trimToMp4Target,
  withMp4Output,
} from "@alloy/media"
import {
  ALL_FORMATS,
  EncodedPacketSink,
  FilePathSource,
  FilePathTarget,
  Input,
  MP4,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny"

/**
 * Main-process media operations via mediabunny packet copy — no decoding, no
 * external binaries. The packet-copy core lives in `@alloy/media`, shared with
 * `packages/server/src/media/trim.ts` and the web upload editor; like there,
 * cuts snap to the nearest preceding video keyframe. Outputs are fragmented
 * MP4s so they stream progressively without a second faststart pass.
 */

export interface VideoFileMeta {
  durationMs: number | null
  width: number | null
  height: number | null
}

/**
 * Duration and display dimensions of a video file, or null when the file has
 * no parseable video track.
 */
export async function probeVideoFileMeta(
  filename: string,
): Promise<VideoFileMeta | null> {
  try {
    const input = new Input({
      source: new FilePathSource(filename),
      formats: ALL_FORMATS,
    })
    try {
      const video = await input.getPrimaryVideoTrack()
      if (!video) return null
      const seconds = await input.computeDuration()
      return {
        durationMs:
          Number.isFinite(seconds) && seconds > 0
            ? Math.round(seconds * 1000)
            : null,
        width: video.displayWidth > 0 ? video.displayWidth : null,
        height: video.displayHeight > 0 ? video.displayHeight : null,
      }
    } finally {
      input.dispose()
    }
  } catch {
    return null
  }
}

/** Duration in ms, or null when the file has no parseable media. */
export async function probeDurationMs(
  filename: string,
): Promise<number | null> {
  try {
    const input = new Input({
      source: new FilePathSource(filename),
      formats: ALL_FORMATS,
    })
    try {
      const seconds = await input.computeDuration()
      return Number.isFinite(seconds) && seconds > 0
        ? Math.round(seconds * 1000)
        : null
    } finally {
      input.dispose()
    }
  } catch {
    return null
  }
}

/**
 * Cut `[startMs, endMs]` out of `srcPath` into an upload-compatible MP4 at
 * `outPath` without re-encoding. The cut start snaps to the nearest preceding
 * video keyframe.
 */
export async function trimMp4(
  srcPath: string,
  outPath: string,
  opts: { startMs: number; endMs: number },
): Promise<void> {
  const input = new Input({
    source: new FilePathSource(srcPath),
    formats: ALL_FORMATS,
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error("Trim source has no video track")
    const audio = await input.getPrimaryAudioTrack()
    assertUploadMp4Compatible(video.codec, audio?.codec ?? null)

    await trimToMp4Target({
      input,
      target: new FilePathTarget(outPath),
      startMs: opts.startMs,
      endMs: opts.endMs,
    })
  } finally {
    input.dispose()
  }
}

/**
 * Copy the full source into an upload-compatible MP4 without decoding. This
 * is the desktop publish/sync normalization boundary: unsupported codecs fail
 * loudly here instead of producing a local file that the server cannot accept.
 */
export async function remuxToUploadMp4(
  srcPath: string,
  outPath: string,
): Promise<void> {
  const input = new Input({
    source: new FilePathSource(srcPath),
    formats: ALL_FORMATS,
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error("Remux source has no video track")
    const audio = await input.getPrimaryAudioTrack()
    const videoCodec = video.codec ?? throwUnknownCodec("video")
    const audioCodec = audio?.codec ?? null
    assertUploadMp4Compatible(videoCodec, audioCodec)

    await withMp4Output(
      new FilePathTarget(outPath),
      video,
      audio,
      async (sinks) => {
        await appendSegment(input, sinks, 0, videoCodec, audioCodec)
      },
    )
  } finally {
    input.dispose()
  }
}

/** Validate an existing MP4 against the same codecs the upload path accepts. */
export async function assertUploadMp4File(srcPath: string): Promise<void> {
  const input = new Input({
    source: new FilePathSource(srcPath),
    formats: [MP4],
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error("MP4 upload source has no video track")
    const audio = await input.getPrimaryAudioTrack()
    assertUploadMp4Compatible(video.codec, audio?.codec ?? null)
  } finally {
    input.dispose()
  }
}

/**
 * Keep the final `keepMs` of `srcPath` in a new MP4 at `outPath`. Returns
 * false (writing nothing) when the source is not longer than `keepMs`, so
 * callers can skip the swap.
 */
export async function trimMp4Tail(
  srcPath: string,
  outPath: string,
  keepMs: number,
): Promise<boolean> {
  const durationMs = await probeDurationMs(srcPath)
  if (durationMs === null) throw new Error("Could not probe trim source.")
  if (durationMs <= keepMs) return false
  await trimMp4(srcPath, outPath, {
    startMs: durationMs - keepMs,
    endMs: durationMs,
  })
  return true
}

/**
 * Concatenate sequential MP4 segments from one recording session into a
 * single MP4 at `outPath`. Pure packet copy: every segment must carry the
 * same codecs (true for OBS split_file output, which never restarts the
 * encoder mid-session). Each segment is rebased against its own first
 * timestamp, so it works whether the muxer reset or continued timestamps
 * across the split.
 */
export async function concatMp4Segments(
  segmentPaths: string[],
  outPath: string,
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error("No segments to concatenate.")
  }

  const first = new Input({
    source: new FilePathSource(segmentPaths[0]),
    formats: ALL_FORMATS,
  })
  try {
    const video = await first.getPrimaryVideoTrack()
    if (!video) throw new Error("Concat source has no video track")
    const audio = await first.getPrimaryAudioTrack()
    const videoCodec = video.codec
    const audioCodec = audio?.codec ?? null

    await withMp4Output(
      new FilePathTarget(outPath),
      video,
      audio,
      async (sinks) => {
        let offsetSec = 0
        for (const path of segmentPaths) {
          const input =
            path === segmentPaths[0]
              ? first
              : new Input({
                  source: new FilePathSource(path),
                  formats: ALL_FORMATS,
                })
          try {
            offsetSec = await appendSegment(
              input,
              sinks,
              offsetSec,
              videoCodec,
              audioCodec,
            )
          } finally {
            if (input !== first) input.dispose()
          }
        }
      },
    )
  } finally {
    first.dispose()
  }
}

/**
 * Copies one segment's packets to the output, rebased to start at
 * `offsetSec`, and returns the offset where the next segment begins.
 */
async function appendSegment(
  input: Input,
  sinks: OutputSinks,
  offsetSec: number,
  videoCodec: InputVideoTrack["codec"],
  audioCodec: InputAudioTrack["codec"] | null,
): Promise<number> {
  const video = await input.getPrimaryVideoTrack()
  if (!video) throw new Error("Concat segment has no video track")
  const audio = await input.getPrimaryAudioTrack()
  if (video.codec !== videoCodec || (audio?.codec ?? null) !== audioCodec) {
    throw new Error("Concat segments carry mismatched codecs")
  }

  const videoSink = new EncodedPacketSink(video)
  const firstVideo = await videoSink.getFirstPacket()
  if (!firstVideo) throw new Error("Concat segment has no video packets")
  // One base per segment keeps the segment's own A/V sync intact.
  const baseSec = firstVideo.timestamp

  let videoEndSec = 0

  const videoMeta = {
    decoderConfig: (await video.getDecoderConfig()) ?? undefined,
  }
  for await (const packet of videoSink.packets(firstVideo)) {
    const timestamp = packet.timestamp - baseSec + offsetSec
    await sinks.video.add(packet.clone({ timestamp }), videoMeta)
    videoEndSec = Math.max(videoEndSec, timestamp + (packet.duration || 0))
  }

  if (audio && sinks.audio) {
    const audioSink = new EncodedPacketSink(audio)
    const meta = {
      decoderConfig: (await audio.getDecoderConfig()) ?? undefined,
    }
    const firstAudio = await audioSink.getFirstPacket()
    if (firstAudio) {
      for await (const packet of audioSink.packets(firstAudio)) {
        const timestamp = packet.timestamp - baseSec + offsetSec
        // Audio leading the first video frame would rebase negative; trade it
        // for the muxer's monotonic, non-negative contract.
        if (timestamp < offsetSec) continue
        await sinks.audio.add(packet.clone({ timestamp }), meta)
      }
    }
  }

  return videoEndSec
}

function throwUnknownCodec(kind: string): never {
  throw new Error(`Media source has an unrecognized ${kind} codec`)
}
