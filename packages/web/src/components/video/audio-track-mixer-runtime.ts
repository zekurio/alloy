import type { AudioTrackMixerController, TrackMix } from "./audio-track-mixer"

/**
 * WebAudio plumbing for the audio track mixer: the per-clip runtime graph
 * (context, per-stem gains, limiter) plus the scheduling helpers that keep
 * the stem sources locked to the `<video>` element's clock.
 */

export const DRIFT_THRESHOLD_SECONDS = 0.25
const POSITION_MATCH_THRESHOLD_SECONDS = 0.1
export const DRIFT_CHECK_INTERVAL_MS = 500
const SCHEDULE_LEAD_SECONDS = 0.02
const GAIN_SMOOTHING_SECONDS = 0.01
export const CLICK_RAMP_SECONDS = 0.008
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 4_000

export type MixerRuntime = {
  key: string
  clipId: string
  context: AudioContext
  masterGain: GainNode
  limiter: DynamicsCompressorNode
  masterLevel: number
  abort: AbortController
  buffers: Map<number, AudioBuffer>
  trackGains: Map<number, GainNode>
  sources: Set<AudioBufferSourceNode>
  ready: boolean
  active: boolean
  activating: boolean
  destroyed: boolean
  startedAt: number
  startedOffset: number
  startedRate: number
  driftTimer: number | null
  suspendTimer: number | null
  removeListeners: (() => void) | null
}

export async function loadTrackBuffers(
  runtime: MixerRuntime,
  mixer: AudioTrackMixerController,
): Promise<Array<readonly [number, AudioBuffer]>> {
  const buffers: Array<readonly [number, AudioBuffer]> = []
  for (const track of mixer.tracks) {
    const encoded = await mixer.loadTrack(track, runtime.abort.signal)
    buffers.push([track.index, await runtime.context.decodeAudioData(encoded)])
  }
  return buffers
}

export function createAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null
  try {
    return new AudioContext()
  } catch {
    return null
  }
}

export function resumeAudioContext(context: AudioContext): Promise<void> {
  if (context.state === "running") return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Audio context resume timed out")),
      AUDIO_CONTEXT_RESUME_TIMEOUT_MS,
    )
    void context.resume().then(
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      (cause: unknown) => {
        window.clearTimeout(timer)
        reject(cause)
      },
    )
  })
}

export function configureLimiter(limiter: DynamicsCompressorNode): void {
  limiter.threshold.value = -6
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
}

export function attachRuntimeListeners(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
  onFailure: (runtime: MixerRuntime) => void,
): () => void {
  const schedule = () => scheduleRuntimeSources(runtime, video)
  const scheduleIfStopped = () => {
    if (
      runtimeMatchesVideoPosition(
        runtime,
        video,
        POSITION_MATCH_THRESHOLD_SECONDS,
      )
    ) {
      return
    }
    schedule()
  }
  const resumeAndSchedule = () => {
    if (!runtime.active) return
    void resumeAudioContext(runtime.context)
      .then(scheduleIfStopped)
      .catch(() => onFailure(runtime))
  }
  const stop = () => stopRuntimeSources(runtime)

  video.addEventListener("play", resumeAndSchedule)
  video.addEventListener("playing", scheduleIfStopped)
  video.addEventListener("pause", stop)
  video.addEventListener("waiting", stop)
  video.addEventListener("seeking", stop)
  video.addEventListener("seeked", schedule)
  video.addEventListener("ended", stop)
  video.addEventListener("emptied", stop)
  video.addEventListener("loadstart", stop)
  return () => {
    video.removeEventListener("play", resumeAndSchedule)
    video.removeEventListener("playing", scheduleIfStopped)
    video.removeEventListener("pause", stop)
    video.removeEventListener("waiting", stop)
    video.removeEventListener("seeking", stop)
    video.removeEventListener("seeked", schedule)
    video.removeEventListener("ended", stop)
    video.removeEventListener("emptied", stop)
    video.removeEventListener("loadstart", stop)
  }
}

export function scheduleRuntimeSources(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
): void {
  const now = runtime.context.currentTime
  const fadeEnd = stopRuntimeSources(runtime)
  if (
    !runtime.ready ||
    !runtime.active ||
    video.paused ||
    video.ended ||
    video.playbackRate !== 1
  ) {
    return
  }

  const rate = video.playbackRate
  const startAt = Math.max(now + SCHEDULE_LEAD_SECONDS, fadeEnd)
  const offset = Math.max(0, video.currentTime + (startAt - now) * rate)
  runtime.startedAt = startAt
  runtime.startedOffset = offset
  runtime.startedRate = rate

  for (const [index, buffer] of runtime.buffers) {
    if (offset >= buffer.duration) continue
    const gain = runtime.trackGains.get(index)
    if (!gain) continue
    const source = runtime.context.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.onended = () => {
      runtime.sources.delete(source)
      source.disconnect()
    }
    source.start(startAt, offset)
    runtime.sources.add(source)
  }

  const master = runtime.masterGain.gain
  master.setValueAtTime(0, startAt)
  master.setTargetAtTime(runtime.masterLevel, startAt, CLICK_RAMP_SECONDS)
}

export function stopRuntimeSources(runtime: MixerRuntime, ramp = true): number {
  const now = runtime.context.currentTime
  const stopAt = ramp ? now + CLICK_RAMP_SECONDS : now
  const master = runtime.masterGain.gain
  master.cancelScheduledValues(now)
  if (!ramp) master.value = 0
  if (ramp) {
    master.setValueAtTime(master.value, now)
    master.linearRampToValueAtTime(0, stopAt)
  }

  const sources = [...runtime.sources]
  runtime.sources.clear()
  runtime.startedAt = Number.NaN
  runtime.startedOffset = Number.NaN
  for (const source of sources) {
    source.stop(stopAt)
    if (!ramp) source.disconnect()
  }
  return stopAt
}

export function runtimeMatchesVideoPosition(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
  threshold: number,
): boolean {
  if (!runtime.active || !Number.isFinite(runtime.startedAt)) return false
  const elapsed = Math.max(0, runtime.context.currentTime - runtime.startedAt)
  const expected = runtime.startedOffset + elapsed * runtime.startedRate
  return Math.abs(video.currentTime - expected) <= threshold
}

export function setMasterGain(runtime: MixerRuntime, value: number): void {
  const now = runtime.context.currentTime
  runtime.masterGain.gain.cancelScheduledValues(now)
  runtime.masterGain.gain.setTargetAtTime(value, now, GAIN_SMOOTHING_SECONDS)
}

export function applyTrackGains(
  runtime: MixerRuntime,
  values: readonly TrackMix[],
  immediate = false,
): void {
  const now = runtime.context.currentTime
  for (const value of values) {
    const gain = runtime.trackGains.get(value.index)?.gain
    if (!gain) continue
    const target = value.muted ? 0 : value.gain
    gain.cancelScheduledValues(now)
    if (immediate) {
      gain.value = target
      continue
    }
    gain.setTargetAtTime(target, now, GAIN_SMOOTHING_SECONDS)
  }
}

export function teardownRuntime(runtime: MixerRuntime): void {
  if (runtime.destroyed) return
  runtime.destroyed = true
  runtime.active = false
  runtime.abort.abort()
  runtime.removeListeners?.()
  if (runtime.driftTimer !== null) window.clearInterval(runtime.driftTimer)
  if (runtime.suspendTimer !== null) window.clearTimeout(runtime.suspendTimer)
  stopRuntimeSources(runtime, false)
  for (const gain of runtime.trackGains.values()) gain.disconnect()
  runtime.masterGain.disconnect()
  runtime.limiter.disconnect()
  if (runtime.context.state !== "closed") {
    void runtime.context.close().catch(() => undefined)
  }
}
