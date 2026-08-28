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
import { cn, sliderValue } from "@alloy/ui/lib/utils"
import { AudioLinesIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MutableRefObject } from "react"

import { api } from "@/lib/api"

const MAX_TRACK_GAIN = 2
const MAX_MIXER_DURATION_MS = 15 * 60 * 1000
const MIXER_MEMORY_MAX_ENTRIES = 20
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

export type TrackMix = {
  index: number
  gain: number
  muted: boolean
}

type MixerEngineStatus = "idle" | "loading" | "engaged" | "error"

export type MixerEngineBinding = {
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
 * whose tracks come from the capture file through the desktop native API.
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
  const disabled = mixer.status === "error"
  // Being rendered is the panel's "opened" moment: load the stems for an
  // already-customized mix, exactly like opening the popover does.
  const prepare = mixer.prepare
  useEffect(() => {
    prepare()
  }, [prepare])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
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

export function hasCustomMix(values: readonly TrackMix[]): boolean {
  return values.some((value) => value.gain !== 1 || value.muted)
}
