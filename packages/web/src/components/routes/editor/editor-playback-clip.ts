import { t as tx } from "@alloy/i18n"
import type { AudioBufferSink, CanvasSink, WrappedCanvas } from "mediabunny"

import type { SourceReader } from "./editor-playback-source"
import type { TimelineClip } from "./editor-project"

/** Audio is scheduled this far ahead of the context clock, in seconds. */
const AUDIO_LOOKAHEAD_S = 1
/** Polling interval of the audio scheduling pump, in ms. */
const AUDIO_PUMP_INTERVAL_MS = 200

/**
 * The live decode state of one timeline clip: a sequential video frame
 * iterator (current frame + one decoded ahead) and an audio pump that
 * schedules buffers on the shared context at absolute times.
 */
export class ClipPlayer {
  current: WrappedCanvas | null = null
  /** First frame of the clip, kept for transition freeze-in. */
  firstFrame: WrappedCanvas | null = null
  /** Engine play-session this player's audio was scheduled in. */
  audioEpoch = -1

  private next: WrappedCanvas | null = null
  private videoIter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null
  private pulling = false
  private videoDone = false
  private disposed = false
  private gainNode: GainNode | null = null
  private audioAbort: AbortController | null = null
  private readonly scheduled = new Set<AudioBufferSourceNode>()

  constructor(
    readonly clip: TimelineClip,
    private readonly reader: SourceReader,
  ) {}

  /** Opens the video pipeline and decodes the first frame. */
  async prepare(fromSourceMs: number): Promise<void> {
    let sink: CanvasSink | null = null
    try {
      sink = await this.reader.createVideoSink()
    } catch {
      return
    }
    if (!sink || this.disposed) return
    this.videoIter = sink.canvases(
      fromSourceMs / 1000,
      this.clip.sourceEndMs / 1000,
    )
    await this.pull()
    if (this.next) {
      this.current = this.next
      this.firstFrame = this.next
      this.next = null
    }
    void this.pull()
  }

  private async pull(): Promise<void> {
    if (!this.videoIter || this.pulling || this.videoDone) return
    this.pulling = true
    try {
      const result = await this.videoIter.next()
      if (this.disposed) return
      if (result.done) {
        this.videoDone = true
        return
      }
      this.next = result.value
    } catch (cause) {
      this.reader.reportError(
        tx('Video decode failed in "{label}": {message}', {
          label: this.clip.label,
          message: cause instanceof Error ? cause.message : tx("unknown error"),
        }),
      )
      this.videoDone = true
    } finally {
      this.pulling = false
    }
  }

  /** Steps the current frame up to the given source position. */
  advanceVideo(sourceMs: number): void {
    if (this.next && this.next.timestamp * 1000 <= sourceMs) {
      this.current = this.next
      this.next = null
    }
    if (!this.next) void this.pull()
  }

  /**
   * Decodes and schedules the clip's audio on the context. `ctxAtFromSource`
   * is the absolute context time at which `fromSourceMs` should be heard;
   * everything after is scheduled relative to it, so two players started
   * with a consistent mapping stay sample-aligned across a cut. Optional
   * fade windows (the two halves of a crossfade) are applied as gain
   * automation in absolute context time.
   */
  async runAudio(
    ctx: AudioContext,
    ctxAtFromSource: number,
    fromSourceMs: number,
    fades: {
      fadeIn: { fromCtxTime: number; toCtxTime: number } | null
      fadeOut: { fromCtxTime: number; toCtxTime: number } | null
    },
    isCurrent: () => boolean,
  ): Promise<void> {
    let sink: AudioBufferSink | null = null
    try {
      sink = await this.reader.createAudioSink()
    } catch {
      return
    }
    // The engine may have paused or jumped while the sink was opening;
    // scheduling now would leak sound into the new play session.
    if (!sink || this.disposed || !isCurrent()) return

    this.stopAudio()
    const abort = new AbortController()
    this.audioAbort = abort
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    this.gainNode = gain
    // A sandwiched clip can carry both ramps; the fade-in always ends
    // before the fade-out begins (transitions can't overlap a whole clip).
    if (fades.fadeIn) {
      gain.gain.setValueAtTime(0.0001, Math.max(0, fades.fadeIn.fromCtxTime))
      gain.gain.linearRampToValueAtTime(1, fades.fadeIn.toCtxTime)
    }
    if (fades.fadeOut) {
      gain.gain.setValueAtTime(1, Math.max(0, fades.fadeOut.fromCtxTime))
      gain.gain.linearRampToValueAtTime(0.0001, fades.fadeOut.toCtxTime)
    }

    const fromSourceSec = fromSourceMs / 1000
    try {
      for await (const { buffer, timestamp } of sink.buffers(
        fromSourceSec,
        this.clip.sourceEndMs / 1000,
      )) {
        if (abort.signal.aborted || this.disposed) break
        const when = ctxAtFromSource + (timestamp - fromSourceSec)
        const node = ctx.createBufferSource()
        node.buffer = buffer
        node.connect(gain)
        const now = ctx.currentTime
        if (when >= now) {
          node.start(when)
        } else if (now - when < buffer.duration) {
          // The first buffer usually starts before the requested position;
          // begin mid-buffer so playback is aligned, not delayed.
          node.start(now, now - when)
        } else {
          continue
        }
        this.scheduled.add(node)
        node.onended = () => this.scheduled.delete(node)

        // Keep roughly AUDIO_LOOKAHEAD_S of audio scheduled ahead.
        while (
          !abort.signal.aborted &&
          when - ctx.currentTime > AUDIO_LOOKAHEAD_S
        ) {
          await abortableSleep(AUDIO_PUMP_INTERVAL_MS, abort.signal)
        }
      }
    } catch {
      // Decode errors leave the clip silent; video keeps rendering.
    }
  }

  stopAudio(): void {
    this.audioAbort?.abort()
    this.audioAbort = null
    for (const node of this.scheduled) {
      try {
        node.stop()
      } catch {
        // Already stopped.
      }
    }
    this.scheduled.clear()
    this.gainNode?.disconnect()
    this.gainNode = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopAudio()
    void this.videoIter?.return(undefined)
    this.videoIter = null
    this.current = null
    this.next = null
    this.firstFrame = null
  }
}

/** Same media + same cut points: an existing player can keep running. */
export function sameClipMedia(a: TimelineClip, b: TimelineClip): boolean {
  return (
    a.sourceId === b.sourceId &&
    a.sourceStartMs === b.sourceStartMs &&
    a.sourceEndMs === b.sourceEndMs &&
    a.startMs === b.startMs
  )
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const handle = setTimeout(() => finish(), ms)
    const finish = () => {
      clearTimeout(handle)
      signal.removeEventListener("abort", finish)
      // oxlint-disable-next-line promise/no-multiple-resolved -- the timer and the abort listener tear each other down before resolving, so only one path runs.
      resolve()
    }
    signal.addEventListener("abort", finish)
  })
}
