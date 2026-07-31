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
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn, sliderValue } from "@alloy/ui/lib/utils"
import { AudioLinesIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MutableRefObject, RefObject } from "react"

import { api } from "@/lib/api"

const MAX_TRACK_GAIN = 2
const MAX_MIXER_DURATION_MS = 15 * 60 * 1000
const MIXER_MEMORY_MAX_ENTRIES = 20
const DRIFT_THRESHOLD_SECONDS = 0.25
const POSITION_MATCH_THRESHOLD_SECONDS = 0.1
const DRIFT_CHECK_INTERVAL_MS = 500
const SCHEDULE_LEAD_SECONDS = 0.02
const GAIN_SMOOTHING_SECONDS = 0.01
const CLICK_RAMP_SECONDS = 0.008
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 4_000
const EMPTY_TRACKS: readonly MixerAudioTrack[] = []

/**
 * Minimal track shape the mixer needs. Server clip stems
 * ({@link ClipAudioTrackRef}) and local desktop capture tracks both satisfy
 * it; how the encoded bytes load is the caller's concern via
 * {@link MixerTrackLoader}.
 */
export interface MixerAudioTrack {
  index: number
  label: string
  /** Cache-busting version, when the source has one. */
  version?: string
}

/** Fetches one track's encoded bytes for WebAudio decoding. */
export type MixerTrackLoader = (
  track: MixerAudioTrack,
  signal: AbortSignal,
) => Promise<ArrayBuffer>

type TrackMix = {
  index: number
  gain: number
  muted: boolean
}

type MixerEngineStatus = "idle" | "loading" | "engaged" | "error"

type MixerEngineBinding = {
  engage: () => void
  updateTrackGains: () => void
}

export type AudioTrackMixerController = {
  key: string
  clipId: string
  tracks: readonly MixerAudioTrack[]
  loadTrack: MixerTrackLoader
  values: readonly TrackMix[]
  status: MixerEngineStatus
  getValues: () => readonly TrackMix[]
  prepare: () => void
  setGain: (index: number, gain: number) => void
  toggleMuted: (index: number) => void
  engineRef: MutableRefObject<MixerEngineBinding | null>
  reset: () => void
  setEngineStatus: (key: string, status: MixerEngineStatus) => void
}

const mixerMemory = new Map<string, Map<number, TrackMix>>()

export function useAudioTrackMixer(
  clipId: string,
  tracks: readonly ClipAudioTrackRef[],
  durationMs?: number | null,
): AudioTrackMixerController {
  const loadTrack = useCallback<MixerTrackLoader>(
    async (track, signal) => {
      const response = await api.request(
        clipAudioTrackFileUrl(clipId, track.index, undefined, track.version),
        { init: { signal } },
      )
      if (!response.ok) {
        throw new Error(
          `Audio track ${track.index} returned ${response.status}`,
        )
      }
      return response.arrayBuffer()
    },
    [clipId],
  )
  return useAudioTrackMixerWithLoader(clipId, tracks, durationMs, loadTrack)
}

/**
 * {@link useAudioTrackMixer} with a caller-supplied track loader, for media
 * whose stems are not served by the clip API — e.g. local desktop captures,
 * whose tracks come off the capture file via the desktop bridge.
 */
export function useAudioTrackMixerWithLoader(
  clipId: string,
  tracks: readonly MixerAudioTrack[],
  durationMs: number | null | undefined,
  loadTrack: MixerTrackLoader,
): AudioTrackMixerController {
  // Decoded PCM is intentionally bounded to short clips. Long clips need a
  // streaming MediaElementAudioSourceNode mixer instead of AudioBuffers.
  const availableTracks =
    durationMs !== null &&
    durationMs !== undefined &&
    durationMs > MAX_MIXER_DURATION_MS
      ? EMPTY_TRACKS
      : tracks
  const key = useMemo(
    () => audioTrackMixerKey(clipId, availableTracks),
    [availableTracks, clipId],
  )
  const engineRef = useRef<MixerEngineBinding | null>(null)
  const tracksRef = useRef(availableTracks)
  const [snapshot, setSnapshot] = useState(() => ({
    clipId,
    values: readTrackMixes(clipId, availableTracks),
  }))
  const values = useMemo(
    () =>
      snapshot.clipId === clipId
        ? normalizeTrackMixes(snapshot.values, clipId, availableTracks)
        : readTrackMixes(clipId, availableTracks),
    [availableTracks, clipId, snapshot],
  )
  const valuesRef = useRef(values)
  const [engineSnapshot, setEngineSnapshot] = useState<{
    key: string
    status: MixerEngineStatus
  }>({ key, status: "idle" })
  const status = engineSnapshot.key === key ? engineSnapshot.status : "idle"

  useEffect(() => {
    tracksRef.current = availableTracks
  }, [availableTracks])
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const setEngineStatus = useCallback(
    (runtimeKey: string, nextStatus: MixerEngineStatus) => {
      if (runtimeKey !== key) return
      setEngineSnapshot((current) => {
        if (current.key === key && current.status === nextStatus) return current
        return { key, status: nextStatus }
      })
    },
    [key],
  )

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
    engineRef.current?.updateTrackGains()
  }, [clipId])
  const getValues = useCallback(() => valuesRef.current, [])
  const prepare = useCallback(() => {
    if (!hasCustomMix(valuesRef.current)) return
    engineRef.current?.engage()
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

  return useMemo(
    () => ({
      key,
      clipId,
      tracks: availableTracks,
      loadTrack,
      values,
      status,
      getValues,
      prepare,
      setGain,
      toggleMuted,
      engineRef,
      reset,
      setEngineStatus,
    }),
    [
      availableTracks,
      clipId,
      getValues,
      key,
      loadTrack,
      prepare,
      reset,
      setEngineStatus,
      setGain,
      status,
      toggleMuted,
      values,
    ],
  )
}

type MixerRuntime = {
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
  const key = mixer?.key ?? ""
  const runtimeRef = useRef<MixerRuntime | null>(null)
  const mixerRef = useRef(mixer)
  const volumeRef = useRef(volume)
  const mutedRef = useRef(muted)
  const engagedRef = useRef(false)
  const failedKeyRef = useRef<string | null>(null)
  const [engagedKey, setEngagedKey] = useState<string | null>(null)

  useEffect(() => {
    mixerRef.current = mixer
  }, [mixer])
  useEffect(() => {
    volumeRef.current = volume
    mutedRef.current = muted
  }, [muted, volume])

  const markFailed = useCallback(
    (runtimeKey: string, clipId: string) => {
      failedKeyRef.current = runtimeKey
      engagedRef.current = false
      setEngagedKey((current) => (current === runtimeKey ? null : current))
      const currentMixer = mixerRef.current
      if (currentMixer?.key === runtimeKey) {
        currentMixer.reset()
        currentMixer.setEngineStatus(runtimeKey, "error")
      }
      const video = videoRef.current
      if (video) video.muted = mutedRef.current
      toast.warning(
        t("Audio tracks could not be loaded. Playing the mixed track instead."),
        { id: `audio-track-mixer-${clipId}` },
      )
    },
    [videoRef],
  )

  const failRuntime = useCallback(
    (runtime: MixerRuntime) => {
      if (runtimeRef.current !== runtime) return
      runtimeRef.current = null
      teardownRuntime(runtime)
      markFailed(runtime.key, runtime.clipId)
    },
    [markFailed],
  )

  const deactivateRuntime = useCallback(
    (runtime: MixerRuntime) => {
      if (runtimeRef.current !== runtime || !runtime.ready) return
      runtime.active = false
      runtime.activating = false
      stopRuntimeSources(runtime)
      engagedRef.current = false
      setEngagedKey((current) => (current === runtime.key ? null : current))
      const currentMixer = mixerRef.current
      if (currentMixer?.key === runtime.key) {
        currentMixer.setEngineStatus(runtime.key, "idle")
      }
      const video = videoRef.current
      if (video) video.muted = mutedRef.current
      if (runtime.suspendTimer !== null) {
        window.clearTimeout(runtime.suspendTimer)
      }
      runtime.suspendTimer = window.setTimeout(() => {
        runtime.suspendTimer = null
        if (runtime.active || runtime.destroyed) return
        void runtime.context.suspend().catch(() => undefined)
      }, CLICK_RAMP_SECONDS * 1000)
    },
    [videoRef],
  )

  const activateRuntime = useCallback(
    (runtime: MixerRuntime) => {
      if (
        runtimeRef.current !== runtime ||
        !runtime.ready ||
        runtime.active ||
        runtime.activating
      ) {
        return
      }
      const video = videoRef.current
      const currentMixer = mixerRef.current
      if (!video || currentMixer?.key !== runtime.key) {
        failRuntime(runtime)
        return
      }
      if (video.playbackRate !== 1) {
        deactivateRuntime(runtime)
        return
      }

      runtime.activating = true
      currentMixer.setEngineStatus(runtime.key, "loading")
      if (runtime.suspendTimer !== null) {
        window.clearTimeout(runtime.suspendTimer)
        runtime.suspendTimer = null
      }
      const finish = () => {
        if (runtimeRef.current !== runtime || runtime.destroyed) return
        runtime.activating = false
        const currentVideo = videoRef.current
        const activeMixer = mixerRef.current
        if (!currentVideo || activeMixer?.key !== runtime.key) {
          failRuntime(runtime)
          return
        }
        if (currentVideo.playbackRate !== 1) {
          deactivateRuntime(runtime)
          return
        }

        runtime.masterLevel = mutedRef.current ? 0 : volumeRef.current
        runtime.masterGain.gain.value = runtime.masterLevel
        applyTrackGains(runtime, activeMixer.getValues(), true)
        runtime.active = true
        currentVideo.muted = true
        engagedRef.current = true
        setEngagedKey(runtime.key)
        activeMixer.setEngineStatus(runtime.key, "engaged")
        scheduleRuntimeSources(runtime, currentVideo)
      }

      if (runtime.context.state === "running") {
        finish()
        return
      }
      void resumeAudioContext(runtime.context)
        .then(finish)
        .catch(() => failRuntime(runtime))
    },
    [deactivateRuntime, failRuntime, videoRef],
  )

  const updateTrackGains = useCallback(() => {
    const runtime = runtimeRef.current
    const currentMixer = mixerRef.current
    if (!runtime?.ready || currentMixer?.key !== runtime.key) return
    applyTrackGains(runtime, currentMixer.getValues())
  }, [])

  const engage = useCallback(() => {
    const currentMixer = mixerRef.current
    const video = videoRef.current
    if (
      !currentMixer ||
      currentMixer.key !== key ||
      currentMixer.tracks.length < 2 ||
      !video ||
      video.playbackRate !== 1 ||
      failedKeyRef.current === key
    ) {
      return
    }

    const existing = runtimeRef.current
    if (existing?.key === key) {
      if (existing.ready) activateRuntime(existing)
      return
    }
    if (existing) {
      runtimeRef.current = null
      teardownRuntime(existing)
    }

    const context = createAudioContext()
    if (!context) {
      markFailed(key, currentMixer.clipId)
      return
    }

    const masterGain = context.createGain()
    const limiter = context.createDynamicsCompressor()
    configureLimiter(limiter)
    masterGain.connect(limiter)
    limiter.connect(context.destination)
    const runtime: MixerRuntime = {
      key,
      clipId: currentMixer.clipId,
      context,
      masterGain,
      limiter,
      masterLevel: mutedRef.current ? 0 : volumeRef.current,
      abort: new AbortController(),
      buffers: new Map(),
      trackGains: new Map(),
      sources: new Set(),
      ready: false,
      active: false,
      activating: false,
      destroyed: false,
      startedAt: Number.NaN,
      startedOffset: Number.NaN,
      startedRate: 1,
      driftTimer: null,
      suspendTimer: null,
      removeListeners: null,
    }
    masterGain.gain.value = runtime.masterLevel
    runtimeRef.current = runtime
    currentMixer.setEngineStatus(key, "loading")

    void Promise.all([
      resumeAudioContext(context),
      loadTrackBuffers(runtime, currentMixer),
    ])
      .then(([, buffers]) => {
        if (runtimeRef.current !== runtime) return
        const currentVideo = videoRef.current
        const activeMixer = mixerRef.current
        if (!currentVideo || activeMixer?.key !== runtime.key) {
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
        // Preferences and track values may have changed during stem loading.
        // Re-apply both at the exact point the graph becomes eligible to play.
        runtime.masterLevel = mutedRef.current ? 0 : volumeRef.current
        runtime.masterGain.gain.value = runtime.masterLevel
        applyTrackGains(runtime, activeMixer.getValues(), true)
        runtime.removeListeners = attachRuntimeListeners(
          runtime,
          currentVideo,
          failRuntime,
        )
        runtime.driftTimer = window.setInterval(() => {
          if (
            runtimeRef.current !== runtime ||
            !runtime.active ||
            currentVideo.paused
          ) {
            return
          }
          if (
            runtimeMatchesVideoPosition(
              runtime,
              currentVideo,
              DRIFT_THRESHOLD_SECONDS,
            )
          ) {
            return
          }
          scheduleRuntimeSources(runtime, currentVideo)
        }, DRIFT_CHECK_INTERVAL_MS)

        if (currentVideo.playbackRate !== 1) {
          deactivateRuntime(runtime)
          return
        }
        activateRuntime(runtime)
      })
      .catch(() => failRuntime(runtime))
  }, [
    activateRuntime,
    deactivateRuntime,
    failRuntime,
    key,
    markFailed,
    videoRef,
  ])

  const binding = useMemo(
    (): MixerEngineBinding => ({ engage, updateTrackGains }),
    [engage, updateTrackGains],
  )
  const engineRef = mixer?.engineRef
  useEffect(() => {
    if (!engineRef) return
    engineRef.current = binding
    return () => {
      if (engineRef.current === binding) engineRef.current = null
    }
  }, [binding, engineRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !key) return
    const handleRateChange = () => {
      const runtime = runtimeRef.current
      if (video.playbackRate !== 1) {
        if (runtime?.key === key) deactivateRuntime(runtime)
        return
      }
      const currentMixer = mixerRef.current
      if (
        currentMixer?.key !== key ||
        !hasCustomMix(currentMixer.getValues())
      ) {
        return
      }
      engage()
    }
    video.addEventListener("ratechange", handleRateChange)
    return () => video.removeEventListener("ratechange", handleRateChange)
  }, [deactivateRuntime, engage, key, videoRef])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime?.ready || runtime.key !== key) return
    runtime.masterLevel = muted ? 0 : volume
    if (runtime.active) {
      setMasterGain(runtime, runtime.masterLevel)
      const video = videoRef.current
      if (video) video.muted = true
    }
  }, [engagedKey, key, muted, videoRef, volume])

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
  if (!mixer || mixer.tracks.length < 2) return null
  const customized = hasCustomMix(mixer.values)
  const title =
    mixer.status === "error"
      ? t("Audio mixer unavailable for this clip.")
      : t("Audio tracks")

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
            aria-label={title}
            title={title}
            className={cn(
              "relative",
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
            {customized && chrome ? (
              <span
                aria-hidden
                className="bg-accent absolute top-2 right-2 size-1.5 rounded-full shadow-[0_0_5px_var(--accent-glow)]"
              />
            ) : null}
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
        <AudioTrackMixerTracks mixer={mixer} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The mixer's track rows: one gain slider and mute toggle per stem, plus the
 * reset action. Shared by the player chrome's popover and the touch editor's
 * inline mixer panel.
 */
export function AudioTrackMixerTracks({
  mixer,
  touch = false,
  className,
}: {
  mixer: AudioTrackMixerController
  /** Grows sliders and toggles to finger-sized targets. */
  touch?: boolean
  className?: string
}) {
  const disabled = mixer.status === "loading" || mixer.status === "error"
  // Being rendered is the panel's "opened" moment: load the stems for an
  // already-customized mix, exactly like opening the popover does.
  const prepare = mixer.prepare
  useEffect(() => {
    prepare()
  }, [prepare])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {mixer.status === "loading" ? (
        <div
          role="status"
          className="text-foreground-muted flex items-center gap-2 text-xs"
        >
          <Spinner className="size-3.5" />
          {t("Loading audio tracks…")}
        </div>
      ) : null}
      {mixer.status === "error" ? (
        <p role="alert" className="text-destructive text-xs">
          {t("Audio mixer unavailable for this clip.")}
        </p>
      ) : null}
      <div className={cn("flex flex-col", touch ? "gap-1" : "gap-3")}>
        {mixer.tracks.map((track) => {
          const value =
            mixer.values.find((candidate) => candidate.index === track.index) ??
            defaultTrackMix(track.index)
          const label = t("{label} volume", { label: track.label })
          return (
            <div key={track.index} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    touch ? "text-sm" : "text-xs",
                  )}
                >
                  {track.label}
                </span>
                <span
                  className={cn(
                    "text-foreground-dim w-10 text-right tabular-nums",
                    touch ? "text-sm" : "text-xs",
                  )}
                >
                  {Math.round(value.gain * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size={touch ? "icon" : "icon-sm"}
                  disabled={disabled}
                  aria-label={t(
                    value.muted ? "Unmute {label}" : "Mute {label}",
                    {
                      label: track.label,
                    },
                  )}
                  onClick={() => mixer.toggleMuted(track.index)}
                  className={cn(
                    !touch && "size-7",
                    value.muted && "text-foreground-faint",
                  )}
                >
                  {value.muted ? <VolumeXIcon /> : <Volume2Icon />}
                </Button>
              </div>
              <label className="block">
                <span className="sr-only">{label}</span>
                <Slider
                  min={0}
                  max={200}
                  step={1}
                  size={touch ? "touch" : "default"}
                  disabled={disabled}
                  value={[value.gain * 100]}
                  onValueChange={(next) =>
                    mixer.setGain(track.index, sliderValue(next, 100) / 100)
                  }
                />
              </label>
            </div>
          )
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size={touch ? "default" : "sm"}
        disabled={disabled || !hasCustomMix(mixer.values)}
        onClick={mixer.reset}
        className="self-start"
      >
        {t("Reset mix")}
      </Button>
    </div>
  )
}

async function loadTrackBuffers(
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

function createAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null
  try {
    return new AudioContext()
  } catch {
    return null
  }
}

function resumeAudioContext(context: AudioContext): Promise<void> {
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

function configureLimiter(limiter: DynamicsCompressorNode): void {
  limiter.threshold.value = -6
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
}

function attachRuntimeListeners(
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

function scheduleRuntimeSources(
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

function stopRuntimeSources(runtime: MixerRuntime, ramp = true): number {
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

function runtimeMatchesVideoPosition(
  runtime: MixerRuntime,
  video: HTMLVideoElement,
  threshold: number,
): boolean {
  if (!runtime.active || !Number.isFinite(runtime.startedAt)) return false
  const elapsed = Math.max(0, runtime.context.currentTime - runtime.startedAt)
  const expected = runtime.startedOffset + elapsed * runtime.startedRate
  return Math.abs(video.currentTime - expected) <= threshold
}

function setMasterGain(runtime: MixerRuntime, value: number): void {
  const now = runtime.context.currentTime
  runtime.masterGain.gain.cancelScheduledValues(now)
  runtime.masterGain.gain.setTargetAtTime(value, now, GAIN_SMOOTHING_SECONDS)
}

function applyTrackGains(
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

function teardownRuntime(runtime: MixerRuntime): void {
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

function audioTrackMixerKey(
  clipId: string,
  tracks: readonly MixerAudioTrack[],
): string {
  return `${clipId}:${tracks
    .map((track) => `${track.index}:${track.version ?? ""}`)
    .join(",")}`
}

function readTrackMixes(
  clipId: string,
  tracks: readonly MixerAudioTrack[],
): TrackMix[] {
  const stored = mixerMemory.get(clipId)
  return tracks.map(
    (track) => stored?.get(track.index) ?? defaultTrackMix(track.index),
  )
}

function normalizeTrackMixes(
  values: readonly TrackMix[],
  clipId: string,
  tracks: readonly MixerAudioTrack[],
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
  mixerMemory.delete(clipId)
  mixerMemory.set(clipId, new Map(values.map((value) => [value.index, value])))
  if (mixerMemory.size <= MIXER_MEMORY_MAX_ENTRIES) return
  const oldest = mixerMemory.keys().next().value
  if (oldest !== undefined) mixerMemory.delete(oldest)
}

function defaultTrackMix(index: number): TrackMix {
  return { index, gain: 1, muted: false }
}

function hasCustomMix(values: readonly TrackMix[]): boolean {
  return values.some((value) => value.gain !== 1 || value.muted)
}
