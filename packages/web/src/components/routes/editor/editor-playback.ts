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

import {
  type ActiveTransition,
  activeTransitionAt,
  clipAtTimelineMs,
  clipEndMs,
  type EditorMediaSource,
  type EditorProject,
  type TimelineClip,
  transitionPreRollMs,
} from "./editor-project"

/**
 * Mediabunny-based preview engine for the multitrack editor. The page owns
 * the master clock (timeline milliseconds); the engine turns that into
 * pixels and sound:
 *
 * - Video decodes through one `CanvasSink` iterator per active clip and is
 *   composited onto the preview canvas every render tick.
 * - Audio decodes through `AudioBufferSink` and is scheduled on a shared
 *   `AudioContext` at absolute times derived from the timeline mapping, so
 *   clip boundaries are sample-accurate.
 * - Upcoming clips are primed ahead of time (pipeline opened, first frame
 *   decoded, audio pre-scheduled), so cuts swap frames instantly instead of
 *   blacking out, and crossfades have both sides ready.
 *
 * The same decode pipeline is what a future export path would drive, just
 * against an `Output` instead of a canvas + audio context.
 */

/** Preview composition resolution; sources letterbox into this via the sink. */
export const PREVIEW_WIDTH = 1280
export const PREVIEW_HEIGHT = 720

/** How far ahead upcoming clips open their pipelines, in timeline ms. */
const PRIME_AHEAD_MS = 1500
/** How long a finished clip's player lingers before disposal. */
const RETIRE_AFTER_MS = 300
/** Audio is scheduled this far ahead of the context clock, in seconds. */
const AUDIO_LOOKAHEAD_S = 1
/** Polling interval of the audio scheduling pump, in ms. */
const AUDIO_PUMP_INTERVAL_MS = 200
/** Headroom between calling play() and the first scheduled sample. */
const PLAY_START_DELAY_S = 0.05

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
class SourceReader {
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

/**
 * The live decode state of one timeline clip: a sequential video frame
 * iterator (current frame + one decoded ahead) and an audio pump that
 * schedules buffers on the shared context at absolute times.
 */
class ClipPlayer {
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
        `Video decode failed in "${this.clip.label}": ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
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

export class PreviewEngine {
  /** Surfaced source/decode failures (set by the preview component). */
  onError: ((message: string) => void) | null = null

  private canvas: HTMLCanvasElement | null = null
  private ctx2d: CanvasRenderingContext2D | null = null
  private project: EditorProject = { tracks: [], clips: [], transitions: [] }
  private sources = new Map<string, EditorMediaSource>()
  private readonly readers = new Map<string, SourceReader>()
  private readonly players = new Map<string, ClipPlayer>()
  private audioCtx: AudioContext | null = null
  private playing = false
  /** Context time corresponding to timeline position 0 (while playing). */
  private ctxAtTimelineZero = 0
  /** Bumped on every play/pause/seek; stale async work checks it. */
  private epoch = 0
  /** Serialized paused-frame rendering: one decode at a time, latest wins. */
  private staticBusy = false
  private staticPendingMs: number | null = null
  /** Identity of the statically drawn frame, to skip no-op redraws. */
  private lastStaticKey: string | null = null
  private disposed = false

  attach(canvas: HTMLCanvasElement): void {
    canvas.width = PREVIEW_WIDTH
    canvas.height = PREVIEW_HEIGHT
    this.canvas = canvas
    this.ctx2d = canvas.getContext("2d")
    this.clear()
  }

  setProject(
    project: EditorProject,
    sources: Map<string, EditorMediaSource>,
  ): void {
    this.project = project
    this.sources = sources
    // Players bound to clips that changed or vanished restart on demand.
    for (const [clipId, player] of this.players) {
      const clip = project.clips.find((entry) => entry.id === clipId)
      if (!clip || !sameClipMedia(clip, player.clip)) {
        player.dispose()
        this.players.delete(clipId)
      }
    }
    // Open every referenced source eagerly: without this, the first pass
    // over a cut or crossfade pays the demuxer-open latency mid-window and
    // the incoming side pops in late.
    for (const clip of project.clips) {
      const existing = this.readers.get(clip.sourceId)
      if (!existing) this.readerFor(clip.sourceId)?.warm()
    }
  }

  play(timelineMs: number): void {
    if (this.disposed) return
    this.audioCtx ??= new AudioContext()
    void this.audioCtx.resume()

    // Paused scrubbing moves the playhead without touching the players, so
    // a player whose decode position no longer matches the resume point
    // (or whose clip is out of range now) restarts from scratch.
    for (const [clipId, player] of this.players) {
      const { clip } = player
      let stale: boolean
      if (timelineMs >= clip.startMs && timelineMs < clipEndMs(clip)) {
        const expectedSourceMs =
          clip.sourceStartMs + (timelineMs - clip.startMs)
        const actualSourceMs = player.current
          ? player.current.timestamp * 1000
          : null
        stale =
          actualSourceMs === null ||
          Math.abs(actualSourceMs - expectedSourceMs) > 150
      } else {
        stale =
          timelineMs >= clipEndMs(clip) ||
          clip.startMs - timelineMs > PRIME_AHEAD_MS
      }
      if (stale) {
        player.dispose()
        this.players.delete(clipId)
      }
    }

    this.playing = true
    this.epoch += 1
    this.staticPendingMs = null
    this.lastStaticKey = null
    this.ctxAtTimelineZero =
      this.audioCtx.currentTime + PLAY_START_DELAY_S - timelineMs / 1000
    this.renderFrame(timelineMs)
  }

  pause(): void {
    this.playing = false
    this.epoch += 1
    // The canvas holds whatever played last; the next static draw must not
    // assume it matches a previously drawn paused frame.
    this.lastStaticKey = null
    for (const player of this.players.values()) player.stopAudio()
  }

  /** Hard jump: tears the pipelines down and redraws statically. */
  seek(timelineMs: number): void {
    this.epoch += 1
    for (const player of this.players.values()) player.dispose()
    this.players.clear()
    if (!this.playing) void this.drawStatic(timelineMs)
  }

  /** Per-tick driver while playing: lifecycle, frame advance, composite. */
  renderFrame(timelineMs: number): void {
    if (this.disposed) return
    const { project } = this

    // Retire players whose clip has fully passed.
    for (const [clipId, player] of this.players) {
      if (timelineMs > clipEndMs(player.clip) + RETIRE_AFTER_MS) {
        player.dispose()
        this.players.delete(clipId)
      }
    }

    const visible = clipAtTimelineMs(project, timelineMs)
    const transition = activeTransitionAt(project, timelineMs)

    // Make sure everything in or near the program window has a player:
    // the visible clip, a fading-in transition partner, and any clip that
    // starts within the priming horizon.
    if (visible) this.ensurePlayer(visible, timelineMs)
    if (transition) this.ensurePlayer(transition.right, timelineMs)
    for (const clip of project.clips) {
      if (
        clip.startMs > timelineMs &&
        clip.startMs - timelineMs <= PRIME_AHEAD_MS
      ) {
        this.ensurePlayer(clip, timelineMs)
      }
    }

    // Advance the frames that are on screen. During a crossfade the
    // incoming clip plays too: the same linear mapping extended before its
    // start yields its pre-roll material (clamped by what was decoded).
    if (visible) {
      const player = this.players.get(visible.id)
      player?.advanceVideo(
        visible.sourceStartMs + (timelineMs - visible.startMs),
      )
    }
    if (transition) {
      const incoming = this.players.get(transition.right.id)
      incoming?.advanceVideo(
        transition.right.sourceStartMs +
          (timelineMs - transition.right.startMs),
      )
    }

    this.composite(visible, transition)
  }

  /**
   * Paused rendering: decode the exact frame(s) under the playhead.
   *
   * Calls coalesce: scrubbing and live drag edits request a redraw per
   * pointer event, but each redraw decodes from the nearest keyframe —
   * letting those run concurrently floods the decoder and chugs the UI.
   * Only one decode runs at a time; intermediate positions are dropped
   * (latest wins), and a redraw whose frame can't differ from what's on
   * the canvas is skipped outright.
   */
  async drawStatic(timelineMs: number): Promise<void> {
    this.staticPendingMs = timelineMs
    if (this.staticBusy || this.disposed) return
    this.staticBusy = true
    try {
      while (this.staticPendingMs !== null && !this.disposed && !this.playing) {
        const target = this.staticPendingMs
        this.staticPendingMs = null
        await this.drawStaticOnce(target)
      }
    } finally {
      this.staticBusy = false
    }
  }

  private async drawStaticOnce(timelineMs: number): Promise<void> {
    const visible = clipAtTimelineMs(this.project, timelineMs)
    const transition = activeTransitionAt(this.project, timelineMs)
    if (!visible) {
      if (this.lastStaticKey !== "empty") {
        this.clear()
        this.lastStaticKey = "empty"
      }
      return
    }

    const sourceMs = Math.round(
      visible.sourceStartMs + (timelineMs - visible.startMs),
    )
    // The incoming side of a crossfade shows its pre-roll material at this
    // point of the window (clamped by its available leading handle).
    const rightSourceMs = transition
      ? Math.round(
          Math.max(
            transition.right.sourceStartMs -
              transitionPreRollMs(transition.transition, transition.right),
            transition.right.sourceStartMs +
              (timelineMs - transition.right.startMs),
          ),
        )
      : 0
    const key = transition
      ? `${visible.sourceId}:${sourceMs}:${transition.right.sourceId}:${rightSourceMs}:${transition.progress.toFixed(2)}`
      : `${visible.sourceId}:${sourceMs}`
    if (key === this.lastStaticKey) return

    const reader = this.readerFor(visible.sourceId)
    const frame = reader ? await reader.staticFrame(sourceMs / 1000) : null
    let overlay: WrappedCanvas | null = null
    if (transition) {
      const rightReader = this.readerFor(transition.right.sourceId)
      overlay = rightReader
        ? await rightReader.staticFrame(rightSourceMs / 1000)
        : null
    }
    // Playback may have started while decoding; don't paint over it.
    if (this.disposed || this.playing) return

    this.clear()
    this.blit(frame, 1)
    if (transition && overlay) this.blit(overlay, transition.progress)
    // A null frame (pipeline still opening, decode failure) leaves the key
    // unset so the next request at this position retries.
    if (frame) this.lastStaticKey = key
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    for (const player of this.players.values()) player.dispose()
    this.players.clear()
    for (const reader of this.readers.values()) reader.dispose()
    this.readers.clear()
    void this.audioCtx?.close()
    this.audioCtx = null
  }

  /* ── Internals ── */

  private readerFor(sourceId: string): SourceReader | null {
    const existing = this.readers.get(sourceId)
    if (existing) return existing
    const source = this.sources.get(sourceId)
    if (!source) return null
    const reader = new SourceReader(source, (message) => {
      if (!this.disposed) this.onError?.(message)
    })
    this.readers.set(sourceId, reader)
    return reader
  }

  /**
   * Creates (or completes) the player for a clip: opens the video pipeline
   * at the right source offset and, while playing, schedules its audio at
   * absolute context times — including the gain ramps of crossfades on
   * either end. A clip entered by a crossfade starts `preRoll` early,
   * playing its trimmed-away lead-in so it lands on its in-point exactly
   * at the cut.
   */
  private ensurePlayer(clip: TimelineClip, timelineMs: number): void {
    const preRollMs = this.incomingPreRollMs(clip)
    let player = this.players.get(clip.id)
    if (!player) {
      const reader = this.readerFor(clip.sourceId)
      if (!reader) return
      player = new ClipPlayer(clip, reader)
      this.players.set(clip.id, player)
      const fromSourceMs =
        clip.sourceStartMs + Math.max(-preRollMs, timelineMs - clip.startMs)
      void player.prepare(fromSourceMs)
    }

    if (this.playing && player.audioEpoch !== this.epoch && this.audioCtx) {
      player.audioEpoch = this.epoch
      const epoch = this.epoch
      const fromTimelineMs = Math.max(timelineMs, clip.startMs - preRollMs)
      const fromSourceMs = clip.sourceStartMs + (fromTimelineMs - clip.startMs)
      const ctxAtFromSource = this.ctxTimeFor(fromTimelineMs)
      const fadeIn =
        preRollMs > 0
          ? {
              fromCtxTime: this.ctxTimeFor(clip.startMs - preRollMs),
              toCtxTime: this.ctxTimeFor(clip.startMs),
            }
          : null
      const outgoing = this.project.transitions.find(
        (transition) => transition.leftClipId === clip.id,
      )
      const right = outgoing
        ? this.project.clips.find((entry) => entry.id === outgoing.rightClipId)
        : undefined
      const fadeOut =
        outgoing && right
          ? {
              fromCtxTime: this.ctxTimeFor(right.startMs - outgoing.durationMs),
              toCtxTime: this.ctxTimeFor(right.startMs),
            }
          : null
      const audioCtx = this.audioCtx
      void player.runAudio(
        audioCtx,
        ctxAtFromSource,
        fromSourceMs,
        { fadeIn, fadeOut },
        () => this.playing && epoch === this.epoch,
      )
    }
  }

  /** Crossfade lead-in available to a clip entered by a transition. */
  private incomingPreRollMs(clip: TimelineClip): number {
    const incoming = this.project.transitions.find(
      (transition) => transition.rightClipId === clip.id,
    )
    return incoming ? transitionPreRollMs(incoming, clip) : 0
  }

  private ctxTimeFor(timelineMs: number): number {
    return this.ctxAtTimelineZero + timelineMs / 1000
  }

  private composite(
    visible: TimelineClip | null,
    transition: ActiveTransition | null,
  ): void {
    this.clear()
    if (!visible) return
    const player = this.players.get(visible.id)
    this.blit(player?.current ?? null, 1)
    if (transition) {
      const incoming = this.players.get(transition.right.id)
      // Live pre-roll frames when the clip has a leading handle; its first
      // decoded frame as the fallback while the pipeline warms up.
      this.blit(
        incoming?.current ?? incoming?.firstFrame ?? null,
        transition.progress,
      )
    }
  }

  private clear(): void {
    if (!this.ctx2d || !this.canvas) return
    this.ctx2d.globalAlpha = 1
    this.ctx2d.fillStyle = "#000"
    this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private blit(frame: WrappedCanvas | null, alpha: number): void {
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

/** Same media + same cut points: an existing player can keep running. */
function sameClipMedia(a: TimelineClip, b: TimelineClip): boolean {
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
