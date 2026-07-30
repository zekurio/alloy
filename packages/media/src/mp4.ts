import {
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  type InputAudioTrack,
  type InputVideoTrack,
  type Target,
} from "mediabunny"

/**
 * Isomorphic MP4 packet-copy primitives shared by the server, the desktop
 * main process, and the web upload editor. Everything here is a pure packet
 * copy — no decoding, no encoding, no WebCodecs — so it runs in Node, Electron
 * main, and the browser alike. Callers supply the mediabunny `Input` (built
 * from a `FilePathSource`/`BlobSource`/…) and `Target` (`FilePathTarget`,
 * `BufferTarget`, …); this module owns the format and the packet plumbing.
 *
 * Outputs are fragmented MP4s so they stream progressively without a second
 * faststart pass. Because packets are copied verbatim, a trim's start snaps to
 * the nearest preceding video keyframe.
 */

export const UPLOAD_MP4_VIDEO_CODECS = new Set(["avc", "hevc", "av1"])
export const UPLOAD_MP4_AUDIO_CODECS = new Set(["aac"])

/**
 * Reject sources whose codecs the upload pipeline cannot accept, before any
 * bytes are written. The audio argument remains scalar-compatible for older
 * callers while accepting every track for multi-track validation.
 */
export function assertUploadMp4Compatible(
  videoCodec: InputVideoTrack["codec"],
  audioCodec:
    | InputAudioTrack["codec"]
    | readonly InputAudioTrack["codec"][]
    | null,
): void {
  if (!videoCodec || !UPLOAD_MP4_VIDEO_CODECS.has(videoCodec)) {
    throw new Error("Only H.264, HEVC, or AV1 video can be uploaded.")
  }
  const audioCodecs = Array.isArray(audioCodec) ? audioCodec : [audioCodec]
  if (
    audioCodecs.some((codec) => codec && !UPLOAD_MP4_AUDIO_CODECS.has(codec))
  ) {
    throw new Error("Only AAC audio can be uploaded.")
  }
}

export interface OutputSinks {
  video: EncodedVideoPacketSource
  /** All audio sinks in input track order. */
  audios: readonly EncodedAudioPacketSource[]
}

/**
 * Runs `copy` against a fragmented-MP4 output configured for the given tracks,
 * finalizing on success and cancelling on failure. The callback owns every
 * output sink; no packets are copied implicitly.
 */
export async function withMp4Output(
  target: Target,
  video: InputVideoTrack,
  audios: readonly InputAudioTrack[],
  copy: (sinks: OutputSinks) => Promise<void>,
): Promise<void> {
  assertUploadMp4Compatible(
    video.codec,
    audios.map((track) => track.codec),
  )

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "fragmented" }),
    target,
  })
  try {
    const videoSource = new EncodedVideoPacketSource(
      video.codec ?? throwUnknownCodec("video"),
    )
    output.addVideoTrack(videoSource)
    const audioSources = audios.map((track) => {
      const source = new EncodedAudioPacketSource(
        track.codec ?? throwUnknownCodec("audio"),
      )
      output.addAudioTrack(source)
      return source
    })

    await output.start()
    await copy({ video: videoSource, audios: audioSources })

    videoSource.close()
    for (const source of audioSources) source.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
}

/**
 * Furthest a stem's first packet may sit into the timeline before decoded
 * PCM (which starts at the first sample) would audibly desync from video.
 * Matches the server-side stem tolerance in
 * `packages/server/src/media/audio-stems.ts`.
 */
const MAX_STEM_LEAD_SEC = 0.06

/**
 * Copy one audio track of `input` into an audio-only fragmented MP4 written
 * to `target`, without re-encoding. Timestamps are preserved verbatim so the
 * extracted stem stays aligned with the source's playback timeline; a track
 * whose first packet leads the timeline by more than ~one AAC frame is
 * rejected, because WebAudio decoding collapses the gap and would play the
 * stem out of sync. Does not dispose `input`; the caller owns its lifecycle.
 */
export async function extractAudioTrackToMp4Target(opts: {
  input: Input
  target: Target
  /** Zero-based container audio track index. */
  trackIndex: number
}): Promise<void> {
  const track = (await opts.input.getAudioTracks())[opts.trackIndex]
  if (!track) throw new Error("Audio extract source has no such audio track")
  const first = await new EncodedPacketSink(track).getFirstPacket()
  if (!first) throw new Error("Audio extract track has no packets")
  if (first.timestamp > MAX_STEM_LEAD_SEC) {
    throw new Error("Audio extract track starts too far into the timeline")
  }

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "fragmented" }),
    target: opts.target,
  })
  try {
    const source = new EncodedAudioPacketSource(
      track.codec ?? throwUnknownCodec("audio"),
    )
    output.addAudioTrack(source)
    await output.start()
    await copyAudioPackets(track, source, 0, undefined)
    source.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
}

/**
 * Cut `[startMs, endMs]` out of `input` into a fragmented MP4 written to
 * `target`, without re-encoding. Every AAC audio track is preserved. The cut
 * start snaps to the nearest preceding video keyframe; the returned
 * `startOffsetMs` is how far into the output the requested start actually sits
 * because of that snap. Does not dispose `input`; the caller owns it.
 */
export async function trimToMp4Target(opts: {
  input: Input
  target: Target
  startMs: number
  endMs: number
  signal?: AbortSignal
  /** Prefix for the error messages this raises, e.g. "Trim source". */
  sourceLabel?: string
}): Promise<{ startOffsetMs: number }> {
  const label = opts.sourceLabel ?? "Trim source"
  throwIfAborted(opts.signal)

  const video = await opts.input.getPrimaryVideoTrack()
  if (!video) throw new Error(`${label} has no video track`)
  const audios = await opts.input.getAudioTracks()
  assertUploadMp4Compatible(
    video.codec,
    audios.map((track) => track.codec),
  )

  const endSec = Math.max(opts.startMs + 1, opts.endMs) / 1000
  const videoSink = new EncodedPacketSink(video)
  const startPacket = await trimStartKeyPacket(videoSink, opts.startMs)
  if (!startPacket) throw new Error(`${label} has no video key packet`)
  // All output timestamps are rebased onto the keyframe the cut snaps to.
  const baseSec = startPacket.timestamp

  await withMp4Output(opts.target, video, audios, async (sinks) => {
    const videoMeta = {
      decoderConfig: (await video.getDecoderConfig()) ?? undefined,
    }
    for await (const packet of videoSink.packets(startPacket, undefined, {
      verifyKeyPackets: true,
    })) {
      throwIfAborted(opts.signal)
      if (packet.timestamp >= endSec) break
      await sinks.video.add(
        packet.clone({ timestamp: packet.timestamp - baseSec }),
        videoMeta,
      )
    }
    for (const [index, track] of audios.entries()) {
      const source = sinks.audios[index]
      if (!source) throw new Error("Missing MP4 audio output sink")
      await copyAudioPackets(track, source, baseSec, endSec, opts.signal)
    }
  })

  throwIfAborted(opts.signal)
  return {
    startOffsetMs: Math.max(
      0,
      Math.round(Math.max(0, opts.startMs) - baseSec * 1000),
    ),
  }
}

/**
 * Timestamp (ms, unrounded) of the video keyframe a packet-copy cut starting
 * at `startMs` snaps to, resolved without copying any packets. Matches the
 * snap `trimToMp4Target` performs, so callers can recompute the start offset
 * of an existing cut. Does not dispose `input`.
 */
export async function snappedTrimStartMs(
  input: Input,
  startMs: number,
): Promise<number> {
  const video = await input.getPrimaryVideoTrack()
  if (!video) throw new Error("Trim source has no video track")
  const packet = await trimStartKeyPacket(new EncodedPacketSink(video), startMs)
  if (!packet) throw new Error("Trim source has no video key packet")
  return packet.timestamp * 1000
}

/** The nearest key packet at or before the requested start. */
async function trimStartKeyPacket(sink: EncodedPacketSink, startMs: number) {
  return (
    (await sink.getKeyPacket(Math.max(0, startMs) / 1000, {
      verifyKeyPackets: true,
    })) ?? (await sink.getFirstKeyPacket({ verifyKeyPackets: true }))
  )
}

/**
 * Copy audio packets in `[baseSec, endSec)`, rebased to `baseSec`. Packets
 * whose rebased timestamp is negative are dropped to satisfy the muxer's
 * monotonic, non-negative contract, costing at most one AAC frame (~20ms).
 */
export async function copyAudioPackets(
  audio: InputAudioTrack,
  audioSource: EncodedAudioPacketSource,
  baseSec: number,
  endSec: number | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const sink = new EncodedPacketSink(audio)
  const meta = { decoderConfig: (await audio.getDecoderConfig()) ?? undefined }
  const first = (await sink.getPacket(baseSec)) ?? (await sink.getFirstPacket())
  if (!first) return
  for await (const packet of sink.packets(first)) {
    throwIfAborted(signal)
    if (endSec !== undefined && packet.timestamp >= endSec) break
    const timestamp = packet.timestamp - baseSec
    if (timestamp < 0) continue
    await audioSource.add(packet.clone({ timestamp }), meta)
  }
}

function throwUnknownCodec(kind: string): never {
  throw new Error(`Media source has an unrecognized ${kind} codec`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
}
