import { t as tx } from "@alloy/i18n"
import {
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedCanvas,
} from "mediabunny"

import { createCaptureSource } from "@/lib/capture-source"

import type { EditorMediaSource } from "./editor-project"
import { drawIncomingTransitionFrame } from "./editor-transition-effects"
import type { EditorTransitionType } from "./editor-transition-presets"

/**
 * Source-side plumbing of the preview engine: byte-range transport into
 * mediabunny, the lazily opened per-source demuxer/track reader, and the
 * canvas surface the engine composites onto.
 */

/** Preview composition resolution; sources letterbox into this via the sink. */
export const PREVIEW_WIDTH = 1280
export const PREVIEW_HEIGHT = 720

/**
 * Lazily opened demuxer + track handles for one media source. Sinks are
 * created per clip player (each needs its own decoder position); the
 * `Input` and a static-frame sink for paused scrubbing are shared.
 */
export class SourceReader {
  private readonly input: Input
  private readonly label: string
  private tracksPromise: Promise<{
    video: InputVideoTrack | null
    audio: InputAudioTrack | null
  }> | null = null
  private staticSinkPromise: Promise<CanvasSink | null> | null = null

  constructor(
    source: EditorMediaSource,
    readonly reportError: (message: string) => void,
  ) {
    this.label = source.label
    this.input = new Input({
      formats: ALL_FORMATS,
      source: createCaptureSource(source.mediaUrl),
    })
  }

  /** Never rejects: open failures report once and read as track-less. */
  private tracks() {
    this.tracksPromise ??= (async () => {
      try {
        const [videoTrack, audioTrack] = await Promise.all([
          this.input.getPrimaryVideoTrack(),
          this.input.getPrimaryAudioTrack(),
        ])
        let video: InputVideoTrack | null = null
        if (!videoTrack) {
          this.reportError(
            tx('"{label}" has no video track.', { label: this.label }),
          )
        } else if (await videoTrack.canDecode()) {
          video = videoTrack
        } else {
          this.reportError(
            tx(
              '"{label}": the {codec} video codec can\'t be decoded for preview.',
              {
                codec: videoTrack.codec ?? tx("unknown"),
                label: this.label,
              },
            ),
          )
        }
        // A missing/undecodable audio track just plays silent.
        const audio =
          audioTrack && (await audioTrack.canDecode()) ? audioTrack : null
        return { video, audio }
      } catch (cause) {
        this.reportError(
          tx('Couldn\'t open "{label}" for preview: {message}', {
            label: this.label,
            message:
              cause instanceof Error ? cause.message : tx("unknown error"),
          }),
        )
        return { video: null, audio: null }
      }
    })()
    return this.tracksPromise
  }

  async createVideoSink(): Promise<CanvasSink | null> {
    const { video } = await this.tracks()
    if (!video) return null
    return new CanvasSink(video, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      fit: "contain",
      // The engine holds at most a current + next frame per player, plus
      // one in flight; the pool keeps VRAM constant without recycling a
      // canvas that is still referenced.
      poolSize: 4,
    })
  }

  async createAudioSink(): Promise<AudioBufferSink | null> {
    const { audio } = await this.tracks()
    return audio ? new AudioBufferSink(audio) : null
  }

  /** Opens the demuxer and track handles ahead of first use. */
  warm(): void {
    void this.tracks()
  }

  /** One-off frame for paused scrubbing; separate sink from the players. */
  async staticFrame(sourceTimeSec: number): Promise<WrappedCanvas | null> {
    try {
      this.staticSinkPromise ??= this.createVideoSink()
      const sink = await this.staticSinkPromise
      if (!sink) return null
      return await sink.getCanvas(sourceTimeSec)
    } catch {
      return null
    }
  }

  dispose(): void {
    this.input.dispose()
  }
}

/** The preview canvas + 2D context the engine composites frames onto. */
export class PreviewSurface {
  private canvas: HTMLCanvasElement | null = null
  private ctx2d: CanvasRenderingContext2D | null = null

  attach(canvas: HTMLCanvasElement): void {
    canvas.width = PREVIEW_WIDTH
    canvas.height = PREVIEW_HEIGHT
    this.canvas = canvas
    this.ctx2d = canvas.getContext("2d")
    this.clear()
  }

  setFilter(filter: string): void {
    if (this.canvas) this.canvas.style.filter = filter
  }

  clear(): void {
    if (!this.ctx2d || !this.canvas) return
    this.ctx2d.globalAlpha = 1
    this.ctx2d.fillStyle = "#000"
    this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  blit(frame: WrappedCanvas | null, alpha: number): void {
    if (!frame || !this.ctx2d || !this.canvas) return
    this.ctx2d.globalAlpha = Math.min(1, Math.max(0, alpha))
    this.ctx2d.drawImage(
      frame.canvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    )
    this.ctx2d.globalAlpha = 1
  }

  transition(
    frame: WrappedCanvas | null,
    type: EditorTransitionType,
    progress: number,
  ): void {
    if (!this.ctx2d || !this.canvas) return
    drawIncomingTransitionFrame(
      this.ctx2d,
      frame?.canvas ?? null,
      type,
      progress,
      this.canvas.width,
      this.canvas.height,
    )
  }
}
