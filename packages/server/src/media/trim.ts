import {
  ALL_FORMATS,
  EncodedAudioPacketSource,
  type EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  FilePathSource,
  FilePathTarget,
  Input,
  Mp4OutputFormat,
  Output,
  type InputAudioTrack,
} from "mediabunny"

/**
 * Cut `[startMs, endMs]` out of `srcPath` into an MP4 at `outPath` without
 * re-encoding. Packets are copied directly, so the cut start snaps to the
 * nearest preceding video keyframe — accepted: desktop performs
 * frame-accurate trims before upload, this path only serves owner trims of
 * already-published clips.
 *
 * Implemented as a manual packet copy rather than mediabunny's `Conversion`
 * trim: `Conversion` decodes (and in Node, with no WebCodecs, drops) any
 * track whose first timestamp precedes the cut point, which is every
 * mid-clip trim.
 *
 * The output is a fragmented MP4 so it streams progressively without a
 * second faststart pass.
 */
export async function trimToMp4(
  srcPath: string,
  outPath: string,
  opts: {
    startMs: number
    endMs: number
    signal?: AbortSignal
  },
): Promise<void> {
  throwIfAborted(opts.signal)

  await copyToFragmentedMp4(srcPath, outPath, {
    startMs: opts.startMs,
    endMs: opts.endMs,
    signal: opts.signal,
    sourceLabel: "Trim source",
  })
}

export async function remuxToFastStartMp4(
  srcPath: string,
  outPath: string,
  opts: { signal?: AbortSignal },
): Promise<void> {
  throwIfAborted(opts.signal)

  await copyToFragmentedMp4(srcPath, outPath, {
    signal: opts.signal,
    sourceLabel: "MP4 source",
  })
}

async function copyToFragmentedMp4(
  srcPath: string,
  outPath: string,
  opts: {
    startMs?: number
    endMs?: number
    signal?: AbortSignal
    sourceLabel: string
  },
): Promise<void> {
  const input = new Input({
    source: new FilePathSource(srcPath),
    formats: ALL_FORMATS,
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error(`${opts.sourceLabel} has no video track`)
    const audio = await input.getPrimaryAudioTrack()

    const requestedStartSec =
      opts.startMs === undefined ? 0 : Math.max(0, opts.startMs) / 1000
    const endSec =
      opts.startMs === undefined || opts.endMs === undefined
        ? undefined
        : Math.max(opts.startMs + 1, opts.endMs) / 1000

    const videoSink = new EncodedPacketSink(video)
    const startPacket = await findVideoStartPacket(
      videoSink,
      requestedStartSec,
      opts.startMs !== undefined,
    )
    if (!startPacket)
      throw new Error(`${opts.sourceLabel} has no video key packet`)
    // All output timestamps are rebased onto the keyframe the cut snaps to.
    const baseSec = startPacket.timestamp

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new FilePathTarget(outPath),
    })
    const onAbort = () => {
      void output.cancel()
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    try {
      const videoSource = new EncodedVideoPacketSource(
        video.codec ?? throwUnknownCodec(opts.sourceLabel, "video"),
      )
      output.addVideoTrack(videoSource)
      const audioSource = audio
        ? new EncodedAudioPacketSource(
            audio.codec ?? throwUnknownCodec(opts.sourceLabel, "audio"),
          )
        : null
      if (audio && audioSource) output.addAudioTrack(audioSource)

      await output.start()

      const videoMeta = {
        decoderConfig: (await video.getDecoderConfig()) ?? undefined,
      }
      for await (const packet of videoSink.packets(startPacket, undefined, {
        verifyKeyPackets: true,
      })) {
        throwIfAborted(opts.signal)
        if (endSec !== undefined && packet.timestamp >= endSec) break
        await videoSource.add(
          packet.clone({ timestamp: packet.timestamp - baseSec }),
          videoMeta,
        )
      }
      videoSource.close()

      if (audio && audioSource) {
        await copyAudioPackets(audio, audioSource, baseSec, endSec, opts.signal)
        audioSource.close()
      }

      await output.finalize()
    } catch (err) {
      await output.cancel().catch(() => undefined)
      throw err
    } finally {
      opts.signal?.removeEventListener("abort", onAbort)
    }
    throwIfAborted(opts.signal)
  } finally {
    input.dispose()
  }
}

async function findVideoStartPacket(
  videoSink: EncodedPacketSink,
  startSec: number,
  keyframeAligned: boolean,
): Promise<EncodedPacket | null> {
  if (!keyframeAligned)
    return videoSink.getFirstPacket({ verifyKeyPackets: true })

  return (
    (await videoSink.getKeyPacket(startSec, {
      verifyKeyPackets: true,
    })) ?? (await videoSink.getFirstKeyPacket({ verifyKeyPackets: true }))
  )
}

async function copyAudioPackets(
  audio: InputAudioTrack,
  audioSource: EncodedAudioPacketSource,
  baseSec: number,
  endSec: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const sink = new EncodedPacketSink(audio)
  const meta = { decoderConfig: (await audio.getDecoderConfig()) ?? undefined }
  const first = (await sink.getPacket(baseSec)) ?? (await sink.getFirstPacket())
  if (!first) return
  for await (const packet of sink.packets(first)) {
    throwIfAborted(signal)
    if (endSec !== undefined && packet.timestamp >= endSec) break
    const timestamp = packet.timestamp - baseSec
    // The packet containing the cut point starts slightly before it; dropping
    // sub-frame negatives keeps the muxer's monotonic, non-negative contract
    // at the cost of at most one audio frame (~20ms) of leading silence.
    if (timestamp < 0) continue
    await audioSource.add(packet.clone({ timestamp }), meta)
  }
}

function throwUnknownCodec(sourceLabel: string, kind: string): never {
  throw new Error(`${sourceLabel} has an unrecognized ${kind} codec`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
}
