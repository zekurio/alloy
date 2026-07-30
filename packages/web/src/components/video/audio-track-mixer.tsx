import { clipAudioTrackFileUrl, type ClipAudioTrackRef } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Slider } from "@alloy/ui/components/slider"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { AudioLinesIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MutableRefObject, RefObject } from "react"

import { api } from "@/lib/api"

const MAX_TRACK_GAIN = 2
const DRIFT_THRESHOLD_SECONDS = 0.25
const DRIFT_CHECK_INTERVAL_MS = 500
const SCHEDULE_LEAD_SECONDS = 0.02

type TrackMix = {
  index: number
  gain: number
  muted: boolean
}

type MixerEngineBinding = {
  engage: () => void
  disengage: () => void
  updateTrackGains: () => void
}

export type AudioTrackMixerController = {
  clipId: string
  tracks: readonly ClipAudioTrackRef[]
  values: readonly TrackMix[]
  getValues: () => readonly TrackMix[]
  prepare: () => void
  setGain: (index: number, gain: number) => void
  toggleMuted: (index: number) => void
  engineRef: MutableRefObject<MixerEngineBinding | null>
  reset: () => void
}

const mixerMemory = new Map<string, Map<number, TrackMix>>()

export function useAudioTrackMixer(
  clipId: string,
  tracks: readonly ClipAudioTrackRef[],
): AudioTrackMixerController {
  const engineRef = useRef<MixerEngineBinding | null>(null)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const [snapshot, setSnapshot] = useState(() => ({
    clipId,
    values: readTrackMixes(clipId, tracks),
  }))
  const values =
    snapshot.clipId === clipId
      ? normalizeTrackMixes(snapshot.values, clipId, tracks)
      : readTrackMixes(clipId, tracks)
  const valuesRef = useRef(values)
  valuesRef.current = values

  const update = useCallback(
    (index: number, change: (current: TrackMix) => TrackMix) => {
      const next = valuesRef.current.map((current) =>
        current.index === index ? change(current) : current,
      )
      valuesRef.current = next
      writeTrackMixes(clipId, next)
      setSnapshot({ clipId, values: next })
      if (hasCustomMix(next)) {
        engineRef.current?.engage()
      } else {
        engineRef.current?.disengage()
      }
      engineRef.current?.updateTrackGains()
    },
    [clipId],
  )

  const reset = useCallback(() => {
    const next = tracksRef.current.map((track) => defaultTrackMix(track.index))
    valuesRef.current = next
    writeTrackMixes(clipId, next)
    setSnapshot({ clipId, values: next })
  }, [clipId])
  const getValues = useCallback(() => valuesRef.current, [])
  const prepare = useCallback(() => {
    if (hasCustomMix(valuesRef.current)) engineRef.current?.engage()
  }, [])
  const setGain = useCallback(
    (index: number, gain: number) =>
      update(index, (current) => ({
        ...current,
        gain: Math.max(0, Math.min(MAX_TRACK_GAIN, gain)),
      })),
    [update],
  )
  const toggleMuted = useCallback(
    (index: number) =>
      update(index, (current) => ({
        ...current,
        muted: !current.muted,
      })),
    [update],
  )

  return {
    clipId,
    tracks,
    values,
    getValues,
    prepare,
    setGain,
    toggleMuted,
    engineRef,
    reset,
  }
}

type MixerRuntime = {
  key: string
  context: AudioContext
  masterGain: GainNode
  abort: AbortController
  buffers: Map<number, AudioBuffer>
  trackGains: Map<number, GainNode>
  sources: AudioBufferSourceNode[]
  ready: boolean
  startedAt: number
  startedOffset: number
  startedRate: number
  driftTimer: number | null
  removeListeners: (() => void) | null
}

export function useAudioTrackMixerEngine({
  mixer,
  videoRef,
  volume,
  muted,
}: {
  mixer?: AudioTrackMixerController
  videoRef: RefObject<HTMLVideoElement | null>
  volume: number
  muted: boolean
}): {
  engaged: boolean
  engagedRef: MutableRefObject<boolean>
} {
  const key = mixer
    ? `${mixer.clipId}:${mixer.tracks
        .map((track) => `${track.index}:${track.version}`)
        .join(",")}`
    : ""
  const runtimeRef = useRef<MixerRuntime | null>(null)
  const mixerRef = useRef(mixer)
  const volumeRef = useRef(volume)
  const mutedRef = useRef(muted)
  const engagedRef = useRef(false)
  const [engagedKey, setEngagedKey] = useState<string | null>(null)
  mixerRef.current = mixer
  volumeRef.current = volume
  mutedRef.current = muted
  engagedRef.current = engagedKey === key

  const failRuntime = useCallback(
    (runtime: MixerRuntime) => {
      if (runtimeRef.current !== runtime) return
      runtimeRef.current = null
      teardownRuntime(runtime)
      engagedRef.current = false
      setEngagedKey(null)
      const video = videoRef.current
      if (video) video.muted = mutedRef.current
      mixerRef.current?.reset()
      toast.warning(
        t("Audio tracks could not be loaded. Playing the mixed track instead."),
        { id: `audio-track-mixer-${mixerRef.current?.clipId ?? "clip"}` },
      )
    },
    [videoRef],
  )

  const updateTrackGains = useCallback(() => {
    const runtime = runtimeRef.current
    const currentMixer = mixerRef.current
    if (!runtime?.ready || !currentMixer) return
    applyTrackGains(runtime, currentMixer.getValues())
  }, [])

  const disengage = useCallback(() => {
    const runtime = runtimeRef.current
    if (!runtime || runtime.key !== key) return
    runtimeRef.current = null
    teardownRuntime(runtime)
    engagedRef.current = false
    setEngagedKey(null)
    const video = videoRef.current
    if (video) video.muted = mutedRef.current
  }, [key, videoRef])

  const engage = useCallback(() => {
    if (!mixerRef.current || mixerRef.current.tracks.length === 0) return
    if (runtimeRef.current?.key === key) return

    const context = createAudioContext()
    if (!context) {
      mixerRef.current.reset()
      toast.warning(
        t("Audio tracks could not be loaded. Playing the mixed track instead."),
        { id: `audio-track-mixer-${mixerRef.current.clipId}` },
      )
      return
    }

    const masterGain = context.createGain()
    masterGain.gain.value = mutedRef.current ? 0 : volumeRef.current
    masterGain.connect(context.destination)
    const runtime: MixerRuntime = {
      key,
      context,
      masterGain,
      abort: new AbortController(),
      buffers: new Map(),
      trackGains: new Map(),
      sources: [],
      ready: false,
      startedAt: 0,
      startedOffset: 0,
      startedRate: 1,
      driftTimer: null,
      removeListeners: null,
    }
    runtimeRef.current = runtime
    const tracks = mixerRef.current.tracks

    void Promise.all([
      context.resume(),
      loadTrackBuffers(runtime, mixerRef.current.clipId, tracks),
    ])
      .then(([, buffers]) => {
        if (runtimeRef.current !== runtime) return
        const video = videoRef.current
        const currentMixer = mixerRef.current
        if (!video || !currentMixer) {
          failRuntime(runtime)
          return
        }

        for (const [index, buffer] of buffers) {
          runtime.buffers.set(index, buffer)
          const gain = context.createGain()
          gain.connect(masterGain)
          runtime.trackGains.set(index, gain)
        }
        runtime.ready = true
        applyTrackGains(runtime, currentMixer.getValues())
        runtime.removeListeners = attachRuntimeListeners(
          runtime,
          video,
          failRuntime,
        )
        runtime.driftTimer = window.setInterval(() => {
          if (runtimeRef.current !== runtime) return
          if (video.paused || runtime.sources.length === 0) return
          const elapsed = Math.max(0, context.currentTime - runtime.startedAt)
          const expected = runtime.startedOffset + elapsed * runtime.startedRate
          if (
            Math.abs(video.currentTime - expected) <= DRIFT_THRESHOLD_SECONDS
          ) {
            return
          }
          scheduleRuntimeSources(runtime, video)
        }, DRIFT_CHECK_INTERVAL_MS)

        // Switch atomically from the embedded mix to the synchronized graph.
        video.muted = true
        engagedRef.current = true
        setEngagedKey(key)
        scheduleRuntimeSources(runtime, video)
      })
      .catch(() => failRuntime(runtime))
  }, [failRuntime, key, videoRef])

  const binding = useMemo(
    (): MixerEngineBinding => ({ engage, disengage, updateTrackGains }),
    [disengage, engage, updateTrackGains],
  )
  useEffect(() => {
    if (!mixer) return
    mixer.engineRef.current = binding
    return () => {
      if (mixer.engineRef.current === binding) mixer.engineRef.current = null
    }
  }, [binding, mixer])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime?.ready || runtime.key !== key) return
    runtime.masterGain.gain.setValueAtTime(
      muted ? 0 : volume,
      runtime.context.currentTime,
    )
    const video = videoRef.current
    if (video) video.muted = true
  }, [key, muted, videoRef, volume])

  useEffect(() => {
    return () => {
      const runtime = runtimeRef.current
      if (!runtime || runtime.key !== key) return
      runtimeRef.current = null
      teardownRuntime(runtime)
      engagedRef.current = false
      setEngagedKey((current) => (current === key ? null : current))
      const video = videoRef.current
      if (video) video.muted = mutedRef.current
    }
  }, [key, videoRef])

  return { engaged: engagedKey === key, engagedRef }
}

export function AudioTrackMixerControl({
  mixer,
  portalContainer,
  chrome = false,
  className,
}: {
  mixer?: AudioTrackMixerController
  portalContainer?: HTMLElement
  chrome?: boolean
  className?: string
}) {
  if (!mixer || mixer.tracks.length === 0) return null
  const customized = hasCustomMix(mixer.values)

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) mixer.prepare()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-video-player-control
            aria-label={t("Audio tracks")}
            title={t("Audio tracks")}
            className={cn(
              chrome
                ? "size-10 rounded-full text-white shadow-none hover:bg-transparent hover:text-white hover:shadow-none focus-visible:ring-ring"
                : "text-foreground-muted",
              customized && !chrome && "text-accent",
              className,
            )}
          >
            <AudioLinesIcon
              className={cn(
                chrome &&
                  "size-[18px] stroke-[2] [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.4))_drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]",
              )}
            />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        side="top"
        portalContainer={portalContainer}
        className="w-72 gap-3 p-3"
        data-video-shortcut-scope="ignore"
      >
        <PopoverTitle>{t("Audio tracks")}</PopoverTitle>
        <div className="flex flex-col gap-3">
          {mixer.tracks.map((track) => {
            const value =
              mixer.values.find(
                (candidate) => candidate.index === track.index,
              ) ?? defaultTrackMix(track.index)
            return (
              <div key={track.index} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {track.label}
                  </span>
                  <span className="text-foreground-dim w-10 text-right text-xs tabular-nums">
                    {Math.round(value.gain * 100)}%
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      value.muted ? "Unmute {label}" : "Mute {label}",
                      {
                        label: track.label,
                      },
                    )}
                    onClick={() => mixer.toggleMuted(track.index)}
                    className={cn(
                      "size-7",
                      value.muted && "text-foreground-faint",
                    )}
                  >
                    {value.muted ? <VolumeXIcon /> : <Volume2Icon />}
                  </Button>
                </div>
                <Slider
                  min={0}
                  max={200}
                  step={1}
                  value={[value.gain * 100]}
                  aria-label={t("{label} volume", { label: track.label })}
                  onValueChange={(next) =>
                    mixer.setGain(track.index, sliderValue(next) / 100)
                  }
                />
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

async function loadTrackBuffers(
  runtime: MixerRuntime,
  clipId: string,
  tracks: readonly ClipAudioTrackRef[],
): Promise<Array<readonly [number, AudioBuffer]>> {
  return Promise.all(
    tracks.map(async (track) => {
      const response = await api.request(
        clipAudioTrackFileUrl(clipId, track.index, track.version),
        { init: { signal: runtime.abort.signal } },
      )
      if (!response.ok) {
        throw new Error(
          `Audio track ${track.index} returned ${response.status}`,
        )
      }
      return [
        track.index,
        await runtime.context.decodeAudioData(await response.arrayBuffer()),
      ] as const
    }),
  )
}

function createAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null
  try {
    return new AudioContext()
  } catch {
    return null
  }
}

function attachRuntimeListeners(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
  onFailure: (runtime: MixerRuntime) => void,
): () => void {
  const schedule = () => scheduleRuntimeSources(runtime, video)
  const scheduleIfStopped = () => {
    if (runtime.sources.length === 0) schedule()
  }
  const resumeAndSchedule = () => {
    void runtime.context
      .resume()
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
  video.addEventListener("ratechange", schedule)
  video.addEventListener("ended", stop)
  return () => {
    video.removeEventListener("play", resumeAndSchedule)
    video.removeEventListener("playing", scheduleIfStopped)
    video.removeEventListener("pause", stop)
    video.removeEventListener("waiting", stop)
    video.removeEventListener("seeking", stop)
    video.removeEventListener("seeked", schedule)
    video.removeEventListener("ratechange", schedule)
    video.removeEventListener("ended", stop)
  }
}

function scheduleRuntimeSources(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
): void {
  stopRuntimeSources(runtime)
  if (!runtime.ready || video.paused || video.ended) return

  const offset = Math.max(0, video.currentTime || 0)
  const startAt = runtime.context.currentTime + SCHEDULE_LEAD_SECONDS
  const rate = Math.max(0.1, video.playbackRate || 1)
  runtime.startedAt = startAt
  runtime.startedOffset = offset
  runtime.startedRate = rate

  for (const [index, buffer] of runtime.buffers) {
    if (offset >= buffer.duration) continue
    const gain = runtime.trackGains.get(index)
    if (!gain) continue
    const source = runtime.context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(gain)
    source.start(startAt, offset)
    runtime.sources.push(source)
  }
}

function stopRuntimeSources(runtime: MixerRuntime): void {
  for (const source of runtime.sources) {
    source.stop()
    source.disconnect()
  }
  runtime.sources = []
}

function applyTrackGains(
  runtime: MixerRuntime,
  values: readonly TrackMix[],
): void {
  for (const value of values) {
    runtime.trackGains
      .get(value.index)
      ?.gain.setValueAtTime(
        value.muted ? 0 : value.gain,
        runtime.context.currentTime,
      )
  }
}

function teardownRuntime(runtime: MixerRuntime): void {
  runtime.abort.abort()
  runtime.removeListeners?.()
  if (runtime.driftTimer !== null) window.clearInterval(runtime.driftTimer)
  stopRuntimeSources(runtime)
  for (const gain of runtime.trackGains.values()) gain.disconnect()
  runtime.masterGain.disconnect()
  if (runtime.context.state !== "closed") {
    void runtime.context.close().catch(() => undefined)
  }
}

function readTrackMixes(
  clipId: string,
  tracks: readonly ClipAudioTrackRef[],
): TrackMix[] {
  const stored = mixerMemory.get(clipId)
  return tracks.map(
    (track) => stored?.get(track.index) ?? defaultTrackMix(track.index),
  )
}

function normalizeTrackMixes(
  values: readonly TrackMix[],
  clipId: string,
  tracks: readonly ClipAudioTrackRef[],
): TrackMix[] {
  const current = new Map(values.map((value) => [value.index, value]))
  const stored = mixerMemory.get(clipId)
  return tracks.map(
    (track) =>
      current.get(track.index) ??
      stored?.get(track.index) ??
      defaultTrackMix(track.index),
  )
}

function writeTrackMixes(clipId: string, values: readonly TrackMix[]): void {
  mixerMemory.set(clipId, new Map(values.map((value) => [value.index, value])))
}

function defaultTrackMix(index: number): TrackMix {
  return { index, gain: 1, muted: false }
}

function hasCustomMix(values: readonly TrackMix[]): boolean {
  return values.some((value) => value.gain !== 1 || value.muted)
}

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 100)
}
