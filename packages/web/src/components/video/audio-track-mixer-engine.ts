import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"

import {
  hasCustomMix,
  type AudioTrackMixerController,
  type MixerEngineBinding,
} from "./audio-track-mixer"
import {
  applyTrackGains,
  attachRuntimeListeners,
  CLICK_RAMP_SECONDS,
  configureLimiter,
  createAudioContext,
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_THRESHOLD_SECONDS,
  loadTrackBuffers,
  resumeAudioContext,
  runtimeMatchesVideoPosition,
  scheduleRuntimeSources,
  setMasterGain,
  stopRuntimeSources,
  teardownRuntime,
  type MixerRuntime,
} from "./audio-track-mixer-runtime"

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
}) {
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
