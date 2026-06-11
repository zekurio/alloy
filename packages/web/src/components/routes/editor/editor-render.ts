import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  type WrappedCanvas,
} from "mediabunny"

import { createCaptureSource } from "./editor-playback"
import {
  activeTransitionAt,
  clipAtTimelineMs,
  clipEndMs,
  type ClipTransition,
  type EditorMediaSource,
  type EditorProject,
  projectDurationMs,
  type TimelineClip,
  transitionPreRollMs,
} from "./editor-project"

/**
 * Offline render of an editor project into an MP4, using the same
 * mediabunny pipeline (and the same program semantics) as the live
 * preview: top track wins, cuts are exact, crossfades blend the incoming
 * clip's pre-roll over the outgoing tail with cross-ramped audio.
 *
 * Video composites frame by frame onto one canvas feeding a
 * `CanvasSource`; audio is mixed in one `OfflineAudioContext` pass with
 * the same gain automation as live playback.
 */

const AUDIO_SAMPLE_RATE = 48_000
/** Progress weights: probing, audio mix, video encode, finalize. */
const PROGRESS_AUDIO_START = 0.02
const PROGRESS_VIDEO_START = 0.15
const PROGRESS_FINALIZE = 0.98

export const RENDER_CODECS = ["avc", "hevc", "vp9", "av1"] as const
export type RenderCodec = (typeof RENDER_CODECS)[number]
/** Output height caps; "source" renders at the largest source's size. */
export const RENDER_RESOLUTIONS = ["source", "1440", "1080", "720"] as const
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number]
export const RENDER_FPS_OPTIONS = [30, 60] as const
export type RenderFps = (typeof RENDER_FPS_OPTIONS)[number]
export const RENDER_QUALITIES = ["medium", "high", "very-high"] as const
export type RenderQuality = (typeof RENDER_QUALITIES)[number]
/**
 * Encoder backend hint. WebCodecs can't target a specific GPU, only express
 * a preference: "gpu" leans on hardware encoders, "cpu" forces software.
 */
export const RENDER_ACCELERATIONS = ["auto", "gpu", "cpu"] as const
export type RenderAcceleration = (typeof RENDER_ACCELERATIONS)[number]

export interface RenderSettings {
  codec: RenderCodec
  resolution: RenderResolution
  fps: RenderFps
  quality: RenderQuality
  acceleration: RenderAcceleration
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  codec: "avc",
  resolution: "1080",
  fps: 60,
  quality: "high",
  acceleration: "auto",
}

const QUALITY_BY_SETTING = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  "very-high": QUALITY_VERY_HIGH,
} as const

const HARDWARE_BY_ACCELERATION = {
  auto: "no-preference",
  gpu: "prefer-hardware",
  cpu: "prefer-software",
} as const satisfies Record<
  RenderAcceleration,
  "no-preference" | "prefer-hardware" | "prefer-software"
>

/** Codecs this machine can actually encode (for the settings form). */
export async function encodableRenderCodecs(): Promise<RenderCodec[]> {
  const checks = await Promise.all(
    RENDER_CODECS.map(async (codec) =>
      (await getFirstEncodableVideoCodec([codec], {
        width: 1920,
        height: 1080,
      }))
        ? codec
        : null,
    ),
  )
  return checks.filter((codec): codec is RenderCodec => codec !== null)
}

export interface RenderedProject {
  data: Uint8Array
  durationMs: number
  width: number
  height: number
}

interface ClipVideoState {
  iter: AsyncGenerator<WrappedCanvas, void, unknown>
  current: WrappedCanvas | null
  next: WrappedCanvas | null
  done: boolean
}

export async function renderProject(
  project: EditorProject,
  sources: Map<string, EditorMediaSource>,
  settings: RenderSettings,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<RenderedProject> {
  const durationMs = projectDurationMs(project)
  if (durationMs <= 0) throw new Error("The timeline is empty.")
  const durationSec = durationMs / 1000
  const fps = settings.fps
  const quality = QUALITY_BY_SETTING[settings.quality]

  /* ── Shared per-source readers ── */

  const inputs = new Map<string, Input>()
  const videoTracks = new Map<string, Promise<InputVideoTrack | null>>()
  const audioTracks = new Map<string, Promise<InputAudioTrack | null>>()

  const inputFor = (sourceId: string): Input => {
    const existing = inputs.get(sourceId)
    if (existing) return existing
    const source = sources.get(sourceId)
    if (!source) throw new Error("A clip references missing media.")
    const input = new Input({
      formats: ALL_FORMATS,
      source: createCaptureSource(source.mediaUrl),
    })
    inputs.set(sourceId, input)
    return input
  }
  const videoTrackFor = (sourceId: string) => {
    let promise = videoTracks.get(sourceId)
    if (!promise) {
      promise = inputFor(sourceId)
        .getPrimaryVideoTrack()
        .then(async (track) =>
          track && (await track.canDecode()) ? track : null,
        )
      videoTracks.set(sourceId, promise)
    }
    return promise
  }
  const audioTrackFor = (sourceId: string) => {
    let promise = audioTracks.get(sourceId)
    if (!promise) {
      promise = inputFor(sourceId)
        .getPrimaryAudioTrack()
        .then(async (track) =>
          track && (await track.canDecode()) ? track : null,
        )
      audioTracks.set(sourceId, promise)
    }
    return promise
  }

  const incomingTransitionFor = (clip: TimelineClip): ClipTransition | null =>
    project.transitions.find(
      (transition) => transition.rightClipId === clip.id,
    ) ?? null
  const outgoingTransitionFor = (clip: TimelineClip): ClipTransition | null =>
    project.transitions.find(
      (transition) => transition.leftClipId === clip.id,
    ) ?? null
  const preRollFor = (clip: TimelineClip): number => {
    const incoming = incomingTransitionFor(clip)
    return incoming ? transitionPreRollMs(incoming, clip) : 0
  }

  const throwIfAborted = () => {
    if (signal.aborted) {
      throw new DOMException("Render canceled.", "AbortError")
    }
  }

  // Set once the output exists, so failures release its encoders.
  let cancelOutput: (() => Promise<void>) | null = null
  // Cancellation must be snappy even while a decode or network read is in
  // flight: disposing the inputs rejects every pending operation, instead
  // of waiting for the frame loop to notice the flag.
  const onAbort = () => {
    for (const input of inputs.values()) input.dispose()
  }
  signal.addEventListener("abort", onAbort)
  try {
    /* ── Output dimensions: largest used source, capped per settings ── */

    const usedSourceIds = [...new Set(project.clips.map((c) => c.sourceId))]
    let maxWidth = 0
    let maxHeight = 0
    for (const sourceId of usedSourceIds) {
      const track = await videoTrackFor(sourceId)
      if (!track) continue
      maxWidth = Math.max(maxWidth, track.displayWidth)
      maxHeight = Math.max(maxHeight, track.displayHeight)
    }
    if (maxWidth <= 0 || maxHeight <= 0) {
      throw new Error("None of the clips have decodable video.")
    }
    const heightCap =
      settings.resolution === "source"
        ? Number.POSITIVE_INFINITY
        : Number(settings.resolution)
    const scale = Math.min(1, heightCap / maxHeight)
    // Encoders want even dimensions.
    const width = Math.max(2, Math.round((maxWidth * scale) / 2) * 2)
    const height = Math.max(2, Math.round((maxHeight * scale) / 2) * 2)
    throwIfAborted()

    /* ── Codec selection + output setup ── */

    const videoCodec = await getFirstEncodableVideoCodec([settings.codec], {
      width,
      height,
    })
    if (!videoCodec) {
      throw new Error(
        "The selected codec can't be encoded on this device at this resolution.",
      )
    }
    const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"])

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    })
    cancelOutput = () => output.cancel()
    const composite = new OffscreenCanvas(width, height)
    const ctx = composite.getContext("2d")
    if (!ctx) throw new Error("Couldn't create the compositing canvas.")
    const videoSource = new CanvasSource(composite, {
      codec: videoCodec,
      bitrate: quality,
      keyFrameInterval: 2,
      hardwareAcceleration: HARDWARE_BY_ACCELERATION[settings.acceleration],
    })
    output.addVideoTrack(videoSource, { frameRate: fps })
    const audioSource = audioCodec
      ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH })
      : null
    if (audioSource) output.addAudioTrack(audioSource)
    await output.start()
    onProgress(PROGRESS_AUDIO_START)

    /* ── Audio: one offline mix with the live preview's gain automation ── */

    if (audioSource) {
      const offline = new OfflineAudioContext(
        2,
        Math.max(1, Math.ceil(durationSec * AUDIO_SAMPLE_RATE)),
        AUDIO_SAMPLE_RATE,
      )
      let clipIndex = 0
      for (const clip of project.clips) {
        throwIfAborted()
        clipIndex += 1
        const track = await audioTrackFor(clip.sourceId)
        if (!track) continue
        const sink = new AudioBufferSink(track)

        const preRollMs = preRollFor(clip)
        const startTimelineSec = (clip.startMs - preRollMs) / 1000
        const fromSourceSec = (clip.sourceStartMs - preRollMs) / 1000
        const clipEndTimelineSec =
          startTimelineSec + clip.sourceEndMs / 1000 - fromSourceSec

        const gain = offline.createGain()
        gain.connect(offline.destination)
        if (preRollMs > 0) {
          gain.gain.setValueAtTime(0.0001, Math.max(0, startTimelineSec))
          gain.gain.linearRampToValueAtTime(1, clip.startMs / 1000)
        }
        const outgoing = outgoingTransitionFor(clip)
        const right = outgoing
          ? project.clips.find((entry) => entry.id === outgoing.rightClipId)
          : undefined
        if (outgoing && right) {
          gain.gain.setValueAtTime(
            1,
            Math.max(0, (right.startMs - outgoing.durationMs) / 1000),
          )
          gain.gain.linearRampToValueAtTime(0.0001, right.startMs / 1000)
        }

        for await (const { buffer, timestamp } of sink.buffers(
          fromSourceSec,
          clip.sourceEndMs / 1000,
        )) {
          throwIfAborted()
          const when = startTimelineSec + (timestamp - fromSourceSec)
          const node = offline.createBufferSource()
          node.buffer = buffer
          node.connect(gain)
          if (when >= 0) {
            node.start(when)
          } else if (-when < buffer.duration) {
            node.start(0, -when)
          } else {
            continue
          }
          // Buffers can overrun the clip's out-point by a packet; clamp so
          // nothing bleeds past the cut.
          node.stop(Math.min(clipEndTimelineSec, durationSec))
        }
        onProgress(
          PROGRESS_AUDIO_START +
            (PROGRESS_VIDEO_START - PROGRESS_AUDIO_START) *
              (clipIndex / project.clips.length),
        )
      }
      const mixed = await offline.startRendering()
      throwIfAborted()
      await audioSource.add(mixed)
    }
    onProgress(PROGRESS_VIDEO_START)

    /* ── Video: composite every output frame like the live preview ── */

    const states = new Map<string, ClipVideoState>()
    const pullInto = async (state: ClipVideoState) => {
      const result = await state.iter.next()
      if (result.done) {
        state.done = true
        state.next = null
      } else {
        state.next = result.value
      }
    }
    const stateFor = async (
      clip: TimelineClip,
      timelineMs: number,
    ): Promise<ClipVideoState | null> => {
      const existing = states.get(clip.id)
      if (existing) return existing
      const track = await videoTrackFor(clip.sourceId)
      if (!track) return null
      const sink = new CanvasSink(track, {
        width,
        height,
        fit: "contain",
        poolSize: 3,
      })
      const preRollMs = preRollFor(clip)
      const fromSourceMs =
        clip.sourceStartMs + Math.max(-preRollMs, timelineMs - clip.startMs)
      const state: ClipVideoState = {
        iter: sink.canvases(fromSourceMs / 1000, clip.sourceEndMs / 1000),
        current: null,
        next: null,
        done: false,
      }
      await pullInto(state)
      state.current = state.next
      state.next = null
      if (!state.done) await pullInto(state)
      states.set(clip.id, state)
      return state
    }
    const frameAt = async (
      state: ClipVideoState,
      sourceMs: number,
    ): Promise<WrappedCanvas | null> => {
      while (state.next && state.next.timestamp * 1000 <= sourceMs) {
        state.current = state.next
        state.next = null
        if (!state.done) await pullInto(state)
      }
      return state.current
    }

    const frameCount = Math.max(1, Math.round(durationSec * fps))
    for (let frame = 0; frame < frameCount; frame++) {
      throwIfAborted()
      const t = (frame * 1000) / fps
      const visible = clipAtTimelineMs(project, t)
      const transition = activeTransitionAt(project, t)

      ctx.globalAlpha = 1
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, width, height)
      if (visible) {
        const state = await stateFor(visible, t)
        const image = state
          ? await frameAt(state, visible.sourceStartMs + (t - visible.startMs))
          : null
        if (image) ctx.drawImage(image.canvas, 0, 0, width, height)
      }
      if (transition) {
        const state = await stateFor(transition.right, t)
        const image = state
          ? await frameAt(
              state,
              transition.right.sourceStartMs + (t - transition.right.startMs),
            )
          : null
        if (image) {
          ctx.globalAlpha = Math.min(1, Math.max(0, transition.progress))
          ctx.drawImage(image.canvas, 0, 0, width, height)
          ctx.globalAlpha = 1
        }
      }

      await videoSource.add(frame / fps, 1 / fps)

      // Release decoders for clips that have fully passed.
      for (const [clipId, state] of states) {
        const clip = project.clips.find((entry) => entry.id === clipId)
        if (!clip || t > clipEndMs(clip)) {
          void state.iter.return(undefined)
          states.delete(clipId)
        }
      }

      if (frame % 30 === 0) {
        onProgress(
          PROGRESS_VIDEO_START +
            (PROGRESS_FINALIZE - PROGRESS_VIDEO_START) * (frame / frameCount),
        )
      }
    }
    for (const state of states.values()) void state.iter.return(undefined)
    states.clear()

    onProgress(PROGRESS_FINALIZE)
    cancelOutput = null
    await output.finalize()
    const buffer = output.target.buffer
    if (!buffer) throw new Error("The encoder produced no output.")
    onProgress(1)

    return { data: new Uint8Array(buffer), durationMs, width, height }
  } catch (cause) {
    await cancelOutput?.().catch(() => {})
    throw cause
  } finally {
    signal.removeEventListener("abort", onAbort)
    for (const input of inputs.values()) input.dispose()
  }
}
