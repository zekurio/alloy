import {
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
  CustomSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedCanvas,
} from "mediabunny"

import type { EditorMediaSource } from "./editor-project"

/**
 * Source-side plumbing of the preview engine: byte-range transport into
 * mediabunny, the lazily opened per-source demuxer/track reader, and the
 * canvas surface the engine composites onto.
 */

/** Preview composition resolution; sources letterbox into this via the sink. */
export const PREVIEW_WIDTH = 1280
export const PREVIEW_HEIGHT = 720

/**
 * Reads a media source by byte range. Two transports share the shape:
 *
 * - The desktop's `alloy-capture://` protocol carries ranges as a
 *   `?range=start-end` query instead of a Range header: a custom header
 *   would force a CORS preflight on the cross-origin fetch to the custom
 *   scheme, while plain GETs work with the protocol's
 *   `Access-Control-Allow-Origin: *` alone.
 * - http(s) URLs (uploaded clips streamed from the server) use a standard
 *   `Range` header against the same-origin stream endpoint.
 *
 * Shared with the render pipeline.
 */
export function createCaptureSource(mediaUrl: string): CustomSource {
  const isHttp = /^https?:\/\//i.test(mediaUrl)
  const fetchRange = async (
    startByte: number,
    endByte: number,
  ): Promise<Response> => {
    let response: Response
    if (isHttp) {
      response = await fetch(mediaUrl, {
        headers: { Range: `bytes=${startByte}-${endByte}` },
      })
    } else {
      const url = new URL(mediaUrl)
      url.searchParams.set("range", `${startByte}-${endByte}`)
      response = await fetch(url)
    }
    if (!response.ok) {
      throw new Error(`Capture media request failed (HTTP ${response.status})`)
    }
    return response
  }

  let sizePromise: Promise<number> | null = null
  return new CustomSource({
    getSize: () => {
      sizePromise ??= (async () => {
        const response = await fetchRange(0, 0)
        const total = Number(
          response.headers.get("Content-Range")?.split("/")[1],
        )
        if (!Number.isFinite(total) || total <= 0) {
          throw new Error("Capture size unavailable")
        }
        return total
      })()
      return sizePromise
    },
    // Mediabunny's `end` is exclusive; the protocol's range is inclusive.
    read: async (start, end) => {
      const response = await fetchRange(start, Math.max(start, end - 1))
      return new Uint8Array(await response.arrayBuffer())
    },
    prefetchProfile: "network",
  })
}

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
          this.reportError(`"${this.label}" has no video track.`)
        } else if (await videoTrack.canDecode()) {
          video = videoTrack
        } else {
          this.reportError(
            `"${this.label}": the ${videoTrack.codec ?? "unknown"} video codec can't be decoded for preview.`,
          )
        }
        // A missing/undecodable audio track just plays silent.
        const audio =
          audioTrack && (await audioTrack.canDecode()) ? audioTrack : null
        return { video, audio }
      } catch (cause) {
        this.reportError(
          `Couldn't open "${this.label}" for preview: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
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
}
