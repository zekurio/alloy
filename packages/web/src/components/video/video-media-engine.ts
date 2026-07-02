import type HlsInstance from "hls.js"
import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

/** HLS playback config for sources that have committed renditions. */
export interface HlsPlayback {
  masterUrl: string
  /** null plays adaptively (Auto); a height pins that tier. */
  selectedHeight: number | null
  /** Progressive per-tier file URLs for pinned playback without MSE. */
  renditionUrls: Record<number, string>
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
  const selectedHeight = hls?.selectedHeight ?? null
  const selectedHeightRef = useRef(selectedHeight)
  useEffect(() => {
    selectedHeightRef.current = selectedHeight
  }, [selectedHeight])

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
        applySelectedLevel(instance, selectedHeightRef.current)
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
    applySelectedLevel(instance, selectedHeight)
  }, [mode, selectedHeight])

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
      selectedHeight !== null
        ? (hls.renditionUrls[selectedHeight] ?? masterUrl)
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
  selectedHeight: number | null,
): void {
  if (selectedHeight === null) {
    instance.currentLevel = -1
    return
  }
  const index = instance.levels.findIndex(
    (level) => level.height === selectedHeight,
  )
  if (index === -1) return
  instance.currentLevel = index
}
