import { useEffect, useState } from "react"

/** Number of min/max samples kept for one source. */
const PEAK_COUNT = 1_200
/** Maximum source bytes kept by Mediabunny while it reads one waveform. */
const MAX_SOURCE_CACHE_BYTES = 8 * 1024 * 1024
/** Keep waveform work bounded even when a page visits many editors. */
const MAX_WAVEFORM_CACHE_ENTRIES = 16
const SAMPLE_POINTS_PER_PEAK = 16

export type MediaWaveformStatus = "loading" | "ready" | "empty" | "error"

export interface MediaWaveformData {
  peaks: Float32Array
  durationMs: number
  hasAudio: boolean
}

export interface MediaWaveformState extends MediaWaveformData {
  status: MediaWaveformStatus
  error: unknown | null
}

const EMPTY_WAVEFORM_DATA: MediaWaveformData = {
  peaks: new Float32Array(),
  durationMs: 0,
  hasAudio: false,
}

const waveformCache = new Map<string, Promise<MediaWaveformData>>()

/**
 * Decodes a compact audio peak series from a media URL. The cache stores only
 * the bounded peak arrays; Mediabunny reads the source through a small range
 * cache and releases it as soon as the input is disposed.
 */
export function mediaWaveform(
  mediaUrl: string,
  cacheKey = mediaUrl,
): Promise<MediaWaveformData> {
  let pending = waveformCache.get(cacheKey)
  if (!pending) {
    pending = loadMediaWaveform(mediaUrl).catch((cause: unknown) => {
      waveformCache.delete(cacheKey)
      throw cause
    })
    waveformCache.set(cacheKey, pending)
    evictWaveformCache()
  }
  return pending
}

/**
 * Loads a waveform for an editor source. A cache key should include the
 * capture or source version when a URL can be reused for changed bytes.
 */
export function useMediaWaveform(
  mediaUrl: string | null,
  cacheKey = mediaUrl,
  durationHintMs = 0,
): MediaWaveformState {
  const [state, setState] = useState<MediaWaveformState>(() =>
    mediaUrl ? loadingWaveform(durationHintMs) : emptyWaveform(durationHintMs),
  )

  useEffect(() => {
    if (!mediaUrl || !cacheKey) {
      setState(emptyWaveform(durationHintMs))
      return
    }

    let active = true
    setState(loadingWaveform(durationHintMs))
    void mediaWaveform(mediaUrl, cacheKey).then(
      (data) => {
        if (!active) return
        setState({
          ...data,
          status: data.hasAudio ? "ready" : "empty",
          error: null,
        })
      },
      () => {
        if (!active) return
        setState({
          ...EMPTY_WAVEFORM_DATA,
          durationMs: durationHintMs,
          status: "error",
          error: new Error("Could not load the media waveform."),
        })
      },
    )

    return () => {
      active = false
    }
  }, [cacheKey, mediaUrl])

  if (state.durationMs > 0 || durationHintMs <= 0) return state
  return { ...state, durationMs: durationHintMs }
}

async function loadMediaWaveform(mediaUrl: string): Promise<MediaWaveformData> {
  const { ALL_FORMATS, AudioBufferSink, Input, UrlSource } =
    await import("mediabunny")
  const input = new Input({
    source: new UrlSource(mediaUrl, {
      maxCacheSize: MAX_SOURCE_CACHE_BYTES,
      parallelism: 1,
      requestInit: { credentials: "include" },
      getRetryDelay: () => null,
    }),
    formats: ALL_FORMATS,
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) {
      const duration = await input.getDurationFromMetadata(undefined, {
        skipLiveWait: true,
      })
      return {
        ...EMPTY_WAVEFORM_DATA,
        durationMs: duration ? Math.max(0, duration * 1000) : 0,
      }
    }

    const firstTimestamp = await audioTrack.getFirstTimestamp()
    const endTimestamp = await audioTrack.computeDuration({
      skipLiveWait: true,
    })
    const startTimestamp = Math.min(0, firstTimestamp)
    const durationSeconds = Math.max(0, endTimestamp - startTimestamp)
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
      return { ...EMPTY_WAVEFORM_DATA, durationMs: 0, hasAudio: true }
    }

    const minima = new Float32Array(PEAK_COUNT).fill(1)
    const maxima = new Float32Array(PEAK_COUNT).fill(-1)
    const sink = new AudioBufferSink(audioTrack)
    const bucketFrames = Math.max(1, (durationSeconds * 48_000) / PEAK_COUNT)
    const stride = Math.max(
      1,
      Math.floor(bucketFrames / SAMPLE_POINTS_PER_PEAK),
    )

    for await (const wrapped of sink.buffers(0, endTimestamp, {
      skipLiveWait: true,
    })) {
      const buffer = wrapped.buffer
      const channelData = Array.from(
        { length: buffer.numberOfChannels },
        (_, channel) => buffer.getChannelData(channel),
      )
      for (let frame = 0; frame < buffer.length; frame += stride) {
        const sourceSeconds =
          wrapped.timestamp - startTimestamp + frame / buffer.sampleRate
        const bucket = Math.floor(
          (sourceSeconds / durationSeconds) * PEAK_COUNT,
        )
        if (bucket < 0 || bucket >= PEAK_COUNT) continue

        let minimum = 1
        let maximum = -1
        for (const channel of channelData) {
          const value = channel[frame] ?? 0
          minimum = Math.min(minimum, value)
          maximum = Math.max(maximum, value)
        }
        minima[bucket] = Math.min(minima[bucket] ?? 1, minimum)
        maxima[bucket] = Math.max(maxima[bucket] ?? -1, maximum)
      }
    }

    const peaks = new Float32Array(PEAK_COUNT * 2)
    for (let index = 0; index < PEAK_COUNT; index++) {
      const minimum = minima[index] === 1 ? 0 : minima[index]
      const maximum = maxima[index] === -1 ? 0 : maxima[index]
      peaks[index * 2] = clampAmplitude(minimum)
      peaks[index * 2 + 1] = clampAmplitude(maximum)
    }

    return {
      peaks,
      durationMs: durationSeconds * 1000,
      hasAudio: true,
    }
  } finally {
    input.dispose()
  }
}

function evictWaveformCache(): void {
  while (waveformCache.size > MAX_WAVEFORM_CACHE_ENTRIES) {
    const oldest = waveformCache.keys().next().value
    if (oldest === undefined) return
    waveformCache.delete(oldest)
  }
}

function clampAmplitude(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
}

function loadingWaveform(durationMs: number): MediaWaveformState {
  return {
    ...EMPTY_WAVEFORM_DATA,
    durationMs,
    status: "loading",
    error: null,
  }
}

function emptyWaveform(durationMs: number): MediaWaveformState {
  return {
    ...EMPTY_WAVEFORM_DATA,
    durationMs,
    status: "empty",
    error: null,
  }
}
