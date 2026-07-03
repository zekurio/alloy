import type HlsInstance from "hls.js"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

/** HLS playback config for sources that have committed renditions. */
export interface HlsPlayback {
  masterUrl: string
  /** null lets hls.js pick adaptively; a rendition pins that tier. */
  selected: { name: string; height: number; fps: number } | null
  /** Progressive per-tier file URLs (keyed by rendition name) for pinned playback without MSE. */
  renditionUrls: Record<string, string>
}

type EngineMode = "progressive" | "native-hls" | "mse"

/**
 * Resolve what the <video> element should actually play. Progressive sources
 * pass through; HLS sources prefer hls.js over MSE, fall back to the
 * platform's native HLS when MSE is unavailable (iOS Safari), and degrade to
 * the progressive fallback when a fatal HLS error occurs — the player must
 * route media element errors through `onMediaError` so native HLS failures
 * degrade too. `mediaKey` identifies the element's effective media: it
 * changes exactly when the element will reload, so the player can capture
 * resume state (hls.js level switches keep the key stable — no reload).
 */
export function useMediaEngine(
  spec: SourceSpec,
  videoRef: RefObject<HTMLVideoElement | null>,
  hls?: HlsPlayback | null,
): {
  src: string | null
  mediaKey: string
  onMediaError: () => boolean
  switchingRendition: boolean
} {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [hlsFailed, setHlsFailed] = useState(false)
  const [switchingRendition, setSwitchingRendition] = useState(false)
  const hlsRef = useRef<HlsInstance | null>(null)
  const switchingRenditionRef = useRef(false)
  const switchingRenditionLevelRef = useRef<number | null>(null)
  const switchingRenditionTimerRef = useRef<number | null>(null)
  const selected = hls?.selected ?? null
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  // Object URL lifecycle for local File sources.
  useEffect(() => {
    if (spec.kind !== "file") {
      setObjectUrl(null)
      return
    }
    const url = createObjectUrl(spec.file, "media source URL")
    setObjectUrl(url)
    return () => revokeObjectUrl(url, "media source URL")
  }, [spec])

  const masterUrl = spec.kind === "url" ? (hls?.masterUrl ?? null) : null
  useEffect(() => {
    setHlsFailed(false)
  }, [masterUrl])

  const finishRenditionSwitch = useCallback(() => {
    switchingRenditionRef.current = false
    switchingRenditionLevelRef.current = null
    setSwitchingRendition(false)
    if (switchingRenditionTimerRef.current === null) return
    window.clearTimeout(switchingRenditionTimerRef.current)
    switchingRenditionTimerRef.current = null
  }, [])

  const startRenditionSwitch = useCallback(
    (level: number | null) => {
      if (selectedRef.current === null) {
        finishRenditionSwitch()
        return
      }
      switchingRenditionRef.current = true
      switchingRenditionLevelRef.current = level
      setSwitchingRendition(true)
      if (switchingRenditionTimerRef.current !== null) {
        window.clearTimeout(switchingRenditionTimerRef.current)
      }
      switchingRenditionTimerRef.current = window.setTimeout(() => {
        finishRenditionSwitch()
      }, 5000)
    },
    [finishRenditionSwitch],
  )

  useEffect(() => finishRenditionSwitch, [finishRenditionSwitch])

  // MSE (hls.js) is preferred whenever the platform has MediaSource:
  // Chromium's built-in HLS player advertises support via canPlayType but
  // cannot switch codecs between variants, which kills Auto on mixed
  // H.264/HEVC ladders. Native HLS is only for platforms without MSE
  // (iOS Safari).
  const mode: EngineMode =
    !masterUrl || hlsFailed
      ? "progressive"
      : supportsMse()
        ? "mse"
        : supportsNativeHls()
          ? "native-hls"
          : "progressive"

  // hls.js lifecycle: one instance per master URL, destroyed on source change
  // or when the engine leaves MSE mode. The import is dynamic so the (large)
  // library is only fetched once a clip actually plays over MSE.
  useEffect(() => {
    if (mode !== "mse" || !masterUrl) return
    let disposed = false
    void (async () => {
      const { default: Hls } = await import("hls.js")
      if (disposed) return
      if (!Hls.isSupported()) {
        setHlsFailed(true)
        return
      }
      const video = videoRef.current
      if (!video) return
      const instance = new Hls({
        // Clips are short; conservative back-buffer keeps memory flat when
        // feeds autoplay many players.
        backBufferLength: 30,
      })
      let recoveredMediaError = false
      const finishPendingSwitch = (level: number | null) => {
        if (!switchingRenditionRef.current) return
        if (
          level !== null &&
          switchingRenditionLevelRef.current !== null &&
          level !== switchingRenditionLevelRef.current
        ) {
          return
        }
        finishRenditionSwitch()
      }
      instance.on(Hls.Events.ERROR, (_event, data) => {
        finishPendingSwitch(null)
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
          recoveredMediaError = true
          instance.recoverMediaError()
          return
        }
        // Unrecoverable: drop to progressive playback of the top rendition.
        instance.destroy()
        if (hlsRef.current === instance) hlsRef.current = null
        setHlsFailed(true)
      })
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        applySelectedLevel(instance, selectedRef.current)
      })
      instance.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        finishPendingSwitch(data.frag.level ?? null)
      })
      instance.attachMedia(video)
      instance.loadSource(masterUrl)
      hlsRef.current = instance
    })()
    return () => {
      disposed = true
      hlsRef.current?.destroy()
      hlsRef.current = null
      finishRenditionSwitch()
    }
  }, [finishRenditionSwitch, masterUrl, mode, videoRef])

  // Pin or release the quality level on the live instance. -1 restores ABR.
  useEffect(() => {
    if (mode !== "mse") {
      finishRenditionSwitch()
      return
    }
    const instance = hlsRef.current
    if (!instance || instance.levels.length === 0) return
    const applied = applySelectedLevel(instance, selected)
    if (applied.changed) {
      startRenditionSwitch(applied.level)
      return
    }
    finishRenditionSwitch()
  }, [finishRenditionSwitch, mode, selected, startRenditionSwitch])

  const nativeHlsUrl =
    mode === "native-hls" && masterUrl && hls
      ? selected !== null
        ? (hls.renditionUrls[selected.name] ?? masterUrl)
        : masterUrl
      : null
  const progressiveUrl = spec.kind === "url" ? spec.url : null

  // Native HLS has no hls.js-style recovery, so a media element error while
  // it plays degrades to the progressive fallback — unless that would just
  // reload the URL that failed. Returns whether the engine switched sources
  // (the error should not surface then).
  const onMediaError = useCallback(() => {
    if (nativeHlsUrl === null || nativeHlsUrl === progressiveUrl) return false
    setHlsFailed(true)
    return true
  }, [nativeHlsUrl, progressiveUrl])

  if (spec.kind === "file") {
    return {
      src: objectUrl,
      mediaKey: objectUrl ? `file:${objectUrl}` : "file",
      onMediaError,
      switchingRendition: false,
    }
  }

  if (mode === "mse") {
    return {
      src: null,
      mediaKey: `mse:${masterUrl}`,
      onMediaError,
      switchingRendition,
    }
  }

  if (nativeHlsUrl !== null) {
    return {
      src: nativeHlsUrl,
      mediaKey: `url:${nativeHlsUrl}`,
      onMediaError,
      switchingRendition: false,
    }
  }

  return {
    src: spec.url,
    mediaKey: `url:${spec.url}`,
    onMediaError,
    switchingRendition: false,
  }
}

function supportsMse(): boolean {
  if (typeof MediaSource === "undefined") return false
  return typeof MediaSource.isTypeSupported === "function"
}

function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false
  return (
    document
      .createElement("video")
      .canPlayType("application/vnd.apple.mpegurl") !== ""
  )
}

function applySelectedLevel(
  instance: HlsInstance,
  selected: { name: string; height: number } | null,
): { changed: boolean; level: number | null } {
  if (selected === null) {
    if (instance.currentLevel === -1) return { changed: false, level: null }
    instance.currentLevel = -1
    return { changed: true, level: null }
  }
  // Renditions are keyed by name in their playlist URLs, so a URL match is
  // exact even when two levels share a height; the height match covers
  // playlists that predate named rendition URLs.
  const needle = `/rendition/${encodeURIComponent(selected.name)}/`
  const byUrl = instance.levels.findIndex((level) =>
    [...level.url, level.uri].some(
      (url) => typeof url === "string" && url.includes(needle),
    ),
  )
  const index =
    byUrl !== -1
      ? byUrl
      : instance.levels.findIndex((level) => level.height === selected.height)
  if (index === -1 || instance.currentLevel === index) {
    return { changed: false, level: null }
  }
  instance.currentLevel = index
  return { changed: true, level: index }
}
