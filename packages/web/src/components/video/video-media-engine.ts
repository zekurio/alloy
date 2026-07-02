import type HlsInstance from "hls.js"
import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

/** HLS playback config for sources that have committed renditions. */
export interface HlsPlayback {
  masterUrl: string
  /** null plays adaptively (Auto); a rendition pins that tier. */
  selected: { name: string; height: number; fps: number } | null
  /** Progressive per-tier file URLs (keyed by rendition name) for pinned playback without MSE. */
  renditionUrls: Record<string, string>
}

type EngineMode = "progressive" | "native-hls" | "mse"

/**
 * Resolve what the <video> element should actually play. Progressive sources
 * pass through; HLS sources prefer the platform's native HLS (Safari/iOS),
 * then hls.js over MSE, and degrade to the progressive fallback when a fatal
 * HLS error occurs. `mediaKey` identifies the element's effective media: it
 * changes exactly when the element will reload, so the player can capture
 * resume state (hls.js level switches keep the key stable — no reload).
 */
export function useMediaEngine(
  spec: SourceSpec,
  videoRef: RefObject<HTMLVideoElement | null>,
  hls?: HlsPlayback | null,
): { src: string | null; mediaKey: string } {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [hlsFailed, setHlsFailed] = useState(false)
  const hlsRef = useRef<HlsInstance | null>(null)
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

  const mode: EngineMode =
    !masterUrl || hlsFailed
      ? "progressive"
      : supportsNativeHls()
        ? "native-hls"
        : "mse"

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
      instance.on(Hls.Events.ERROR, (_event, data) => {
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
      instance.attachMedia(video)
      instance.loadSource(masterUrl)
      hlsRef.current = instance
    })()
    return () => {
      disposed = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [masterUrl, mode, videoRef])

  // Pin or release the quality level on the live instance. -1 restores ABR.
  useEffect(() => {
    if (mode !== "mse") return
    const instance = hlsRef.current
    if (!instance || instance.levels.length === 0) return
    applySelectedLevel(instance, selected)
  }, [mode, selected])

  if (spec.kind === "file") {
    return {
      src: objectUrl,
      mediaKey: objectUrl ? `file:${objectUrl}` : "file",
    }
  }

  if (mode === "mse") {
    return { src: null, mediaKey: `mse:${masterUrl}` }
  }

  if (mode === "native-hls" && masterUrl && hls) {
    const url =
      selected !== null
        ? (hls.renditionUrls[selected.name] ?? masterUrl)
        : masterUrl
    return { src: url, mediaKey: `url:${url}` }
  }

  return { src: spec.url, mediaKey: `url:${spec.url}` }
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
): void {
  if (selected === null) {
    instance.currentLevel = -1
    return
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
  if (index === -1) return
  instance.currentLevel = index
}
