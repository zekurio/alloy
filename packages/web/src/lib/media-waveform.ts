import { useEffect, useState } from "react"

/** Number of min/max samples kept for one source. */
const PEAK_COUNT = 1_200
/** Maximum source bytes kept by Mediabunny while it reads one waveform. */
const MAX_SOURCE_CACHE_BYTES = 8 * 1024 * 1024
/** Keep completed peak data bounded when a page visits many editors. */
const MAX_WAVEFORM_CACHE_ENTRIES = 16
const SAMPLE_POINTS_PER_PEAK = 16
const NORMALIZATION_PERCENTILE = 0.98

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

/** Range in the media file that maps to waveform time zero and duration. */
export interface MediaWaveformRange {
  startMs: number
  endMs: number
}

const EMPTY_WAVEFORM_DATA: MediaWaveformData = {
  peaks: new Float32Array(),
  durationMs: 0,
  hasAudio: false,
}

interface PendingWaveform {
  controller: AbortController
  consumers: number
  promise: Promise<MediaWaveformData>
}

const waveformCache = new Map<string, MediaWaveformData>()
const pendingWaveforms = new Map<string, PendingWaveform>()

/**
 * Loads a waveform for an editor source. A cache key should include the
 * capture or source version when a URL can be reused for changed bytes.
 */
export function useMediaWaveform(
  mediaUrl: string | null,
  cacheKey = mediaUrl,
  durationHintMs = 0,
  range?: MediaWaveformRange,
): MediaWaveformState {
  const [state, setState] = useState<MediaWaveformState>(() =>
    mediaUrl ? loadingWaveform(durationHintMs) : emptyWaveform(durationHintMs),
  )

  useEffect(() => {
    if (!mediaUrl || !cacheKey) {
      setState(emptyWaveform(durationHintMs))
      return
    }

    const durationMs = finiteDurationMs(durationHintMs)
    const normalizedRange = normalizeWaveformRange(range)
    const request = acquireMediaWaveform(
      mediaUrl,
      `${cacheKey}:duration:${durationMs}:range:${waveformRangeKey(normalizedRange)}`,
      durationMs,
      normalizedRange,
    )
    let active = true
    setState(loadingWaveform(durationMs))
    void request.promise.then(
      (data) => {
        if (!active) return
        setState({
          ...data,
          status: data.hasAudio ? "ready" : "empty",
          error: null,
        })
      },
      (cause: unknown) => {
        if (!active) return
        setState({
          ...EMPTY_WAVEFORM_DATA,
          durationMs,
          status: "error",
          error: cause,
        })
      },
    )

    return () => {
      active = false
      request.release()
    }
  }, [cacheKey, durationHintMs, mediaUrl, range?.endMs, range?.startMs])

  if (state.durationMs > 0 || durationHintMs <= 0) return state
  return { ...state, durationMs: durationHintMs }
}

/**
 * Decodes a compact audio peak series from a media URL. Completed entries
 * store only bounded peak arrays. In-flight work stops when its last editor
 * leaves.
 */
function acquireMediaWaveform(
  mediaUrl: string,
  cacheKey: string,
  durationHintMs: number,
  range: MediaWaveformRange | undefined,
) {
  const cached = waveformCache.get(cacheKey)
  if (cached) {
    waveformCache.delete(cacheKey)
    waveformCache.set(cacheKey, cached)
    return { promise: Promise.resolve(cached), release: () => undefined }
  }

  const existing = pendingWaveforms.get(cacheKey)
  const pending =
    existing ?? startMediaWaveform(mediaUrl, cacheKey, durationHintMs, range)
  pending.consumers += 1
  let released = false
  return {
    promise: pending.promise,
    release: () => {
      if (released) return
      released = true
      pending.consumers -= 1
      if (pending.consumers > 0) return
      if (pendingWaveforms.get(cacheKey) !== pending) return
      pendingWaveforms.delete(cacheKey)
      pending.controller.abort()
    },
  }
}

function startMediaWaveform(
  mediaUrl: string,
  cacheKey: string,
  durationHintMs: number,
  range: MediaWaveformRange | undefined,
): PendingWaveform {
  const controller = new AbortController()
  const promise = loadMediaWaveform(
    mediaUrl,
    durationHintMs,
    controller.signal,
    range,
  ).then((data) => {
    if (!controller.signal.aborted) cacheWaveform(cacheKey, data)
    return data
  })
  const pending = { controller, consumers: 0, promise }
  pendingWaveforms.set(cacheKey, pending)
  void promise.then(
    () => finishPendingWaveform(cacheKey, pending),
    () => finishPendingWaveform(cacheKey, pending),
  )
  return pending
}

async function loadMediaWaveform(
  mediaUrl: string,
  durationHintMs: number,
  signal: AbortSignal,
  range: MediaWaveformRange | undefined,
): Promise<MediaWaveformData> {
  const { ALL_FORMATS, AudioBufferSink, Input, UrlSource } =
    await import("mediabunny")
  const input = new Input({
    source: new UrlSource(mediaUrl, {
      maxCacheSize: MAX_SOURCE_CACHE_BYTES,
      parallelism: 1,
      requestInit: { credentials: mediaRequestCredentials(mediaUrl) },
      fetchFn: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([signal, init.signal])
            : signal,
        }),
      getRetryDelay: (attempt) =>
        attempt < 3 ? 0.25 * 2 ** Math.max(0, attempt - 1) : null,
    }),
    formats: ALL_FORMATS,
  })
  const abort = () => input.dispose()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()

  try {
    const metadataDuration = await input.getDurationFromMetadata(undefined, {
      skipLiveWait: true,
    })
    const hintedDuration = durationHintMs / 1000
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) {
      const bounds = waveformBounds(range, hintedDuration, metadataDuration)
      return {
        ...EMPTY_WAVEFORM_DATA,
        durationMs: bounds.durationSeconds * 1000,
      }
    }

    const endTimestamp = await audioTrack.computeDuration({
      skipLiveWait: true,
    })
    const bounds = waveformBounds(
      range,
      hintedDuration,
      metadataDuration,
      endTimestamp,
    )
    const durationSeconds = bounds.durationSeconds
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

    for await (const wrapped of sink.buffers(
      bounds.startSeconds,
      bounds.endSeconds,
      { skipLiveWait: true },
    )) {
      const buffer = wrapped.buffer
      const channelData = Array.from(
        { length: buffer.numberOfChannels },
        (_, channel) => buffer.getChannelData(channel),
      )
      for (let frame = 0; frame < buffer.length; frame += stride) {
        const sourceSeconds =
          wrapped.timestamp - bounds.startSeconds + frame / buffer.sampleRate
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
    const amplitudes: number[] = []
    for (let index = 0; index < PEAK_COUNT; index++) {
      const minimum = minima[index] === 1 ? 0 : minima[index]
      const maximum = maxima[index] === -1 ? 0 : maxima[index]
      peaks[index * 2] = minimum
      peaks[index * 2 + 1] = maximum
      const amplitude = Math.max(Math.abs(minimum), Math.abs(maximum))
      if (amplitude > 0) amplitudes.push(amplitude)
    }
    amplitudes.sort((left, right) => left - right)
    const reference =
      amplitudes[
        Math.floor((amplitudes.length - 1) * NORMALIZATION_PERCENTILE)
      ] ?? 0
    const gain = reference > 0 ? 0.92 / reference : 1
    for (let index = 0; index < peaks.length; index++) {
      peaks[index] = clampAmplitude((peaks[index] ?? 0) * gain)
    }

    return {
      peaks,
      durationMs: durationSeconds * 1000,
      hasAudio: true,
    }
  } finally {
    signal.removeEventListener("abort", abort)
    input.dispose()
  }
}

function finishPendingWaveform(
  cacheKey: string,
  pending: PendingWaveform,
): void {
  if (pendingWaveforms.get(cacheKey) === pending) {
    pendingWaveforms.delete(cacheKey)
  }
}

function cacheWaveform(cacheKey: string, data: MediaWaveformData): void {
  waveformCache.delete(cacheKey)
  waveformCache.set(cacheKey, data)
  evictWaveformCache()
}

function evictWaveformCache(): void {
  while (waveformCache.size > MAX_WAVEFORM_CACHE_ENTRIES) {
    const oldest = waveformCache.keys().next().value
    if (oldest === undefined) return
    waveformCache.delete(oldest)
  }
}

function mediaRequestCredentials(mediaUrl: string): RequestCredentials {
  const protocol = new URL(mediaUrl, window.location.href).protocol
  return protocol === "http:" || protocol === "https:" ? "include" : "omit"
}

function sourceDurationSeconds(...durations: Array<number | null>): number {
  return Math.max(
    0,
    ...durations.map((duration) =>
      duration !== null && Number.isFinite(duration) ? duration : 0,
    ),
  )
}

function waveformBounds(
  range: MediaWaveformRange | undefined,
  ...durations: Array<number | null>
) {
  const sourceDuration = sourceDurationSeconds(...durations)
  const startSeconds = range ? range.startMs / 1_000 : 0
  const requestedEnd = range ? range.endMs / 1_000 : sourceDuration
  const endSeconds =
    sourceDuration > 0 ? Math.min(requestedEnd, sourceDuration) : requestedEnd
  return {
    startSeconds,
    endSeconds,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
  }
}

function normalizeWaveformRange(
  range: MediaWaveformRange | undefined,
): MediaWaveformRange | undefined {
  if (!range) return undefined
  if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
    return undefined
  }
  const startMs = Math.max(0, range.startMs)
  return range.endMs > startMs ? { startMs, endMs: range.endMs } : undefined
}

function waveformRangeKey(range: MediaWaveformRange | undefined): string {
  return range ? `${range.startMs}-${range.endMs}` : "full"
}

function finiteDurationMs(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
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
