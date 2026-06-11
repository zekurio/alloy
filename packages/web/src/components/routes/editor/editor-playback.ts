import type { WrappedCanvas } from "mediabunny"

import { ClipPlayer, sameClipMedia } from "./editor-playback-clip"
import { PreviewSurface, SourceReader } from "./editor-playback-source"
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
import { incomingPreRollMs, outgoingTransitionFor } from "./editor-transitions"

export {
  createCaptureSource,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
} from "./editor-playback-source"

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

/** How far ahead upcoming clips open their pipelines, in timeline ms. */
const PRIME_AHEAD_MS = 1500
/** How long a finished clip's player lingers before disposal. */
const RETIRE_AFTER_MS = 300
/** Headroom between calling play() and the first scheduled sample. */
const PLAY_START_DELAY_S = 0.05

export class PreviewEngine {
  /** Surfaced source/decode failures (set by the preview component). */
  onError: ((message: string) => void) | null = null

  private readonly surface = new PreviewSurface()
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
    this.surface.attach(canvas)
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
        this.surface.clear()
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

    this.surface.clear()
    this.surface.blit(frame, 1)
    if (transition && overlay) this.surface.blit(overlay, transition.progress)
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
    const preRollMs = incomingPreRollMs(this.project, clip)
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
      const outgoing = outgoingTransitionFor(this.project, clip)
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

  private ctxTimeFor(timelineMs: number): number {
    return this.ctxAtTimelineZero + timelineMs / 1000
  }

  private composite(
    visible: TimelineClip | null,
    transition: ActiveTransition | null,
  ): void {
    this.surface.clear()
    if (!visible) return
    const player = this.players.get(visible.id)
    this.surface.blit(player?.current ?? null, 1)
    if (transition) {
      const incoming = this.players.get(transition.right.id)
      // Live pre-roll frames when the clip has a leading handle; its first
      // decoded frame as the fallback while the pipeline warms up.
      this.surface.blit(
        incoming?.current ?? incoming?.firstFrame ?? null,
        transition.progress,
      )
    }
  }
}
