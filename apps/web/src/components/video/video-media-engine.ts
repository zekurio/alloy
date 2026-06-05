import type HlsType from "hls.js"
import * as React from "react"

import { clientLogger } from "@/lib/client-log"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

/** Selected HLS rendition: a target height in pixels, or adaptive ("auto"). */
export type HlsLevelSelection = number | "auto"

declare global {
  // Safari/iOS expose Managed Media Source instead of MediaSource; it isn't in
  // the standard DOM lib, so we declare it as an optional global here.
  interface Window {
    ManagedMediaSource?: typeof MediaSource
  }
}

// A representative H.264 + AAC codec string. If the browser can build an MSE
// SourceBuffer for it, hls.js can drive playback and we get seamless manual
// level switching; otherwise we fall back to native HLS (Safari/iOS).
const PROBE_CODECS = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'

let mseCache: boolean | null = null
let nativeCache: boolean | null = null

/** Whether Media Source Extensions can play fragmented MP4 — the requirement
 *  for hls.js. Cached; the answer can't change within a session. */
export function mseHlsSupported(): boolean {
  if (mseCache !== null) return mseCache
  if (typeof window === "undefined") return (mseCache = false)
  const MS = window.MediaSource ?? window.ManagedMediaSource
  mseCache = Boolean(
    MS &&
    typeof MS.isTypeSupported === "function" &&
    MS.isTypeSupported(PROBE_CODECS),
  )
  return mseCache
}

/** Whether the browser can play an HLS manifest natively (Safari, iOS). */
export function nativeHlsSupported(): boolean {
  if (nativeCache !== null) return nativeCache
  if (typeof document === "undefined") return (nativeCache = false)
  const video = document.createElement("video")
  nativeCache = video.canPlayType("application/vnd.apple.mpegurl") !== ""
  return nativeCache
}

/** True when this browser can play HLS at all, either engine. */
export function hlsPlaybackSupported(): boolean {
  return mseHlsSupported() || nativeHlsSupported()
}

function applyLevel(hls: HlsType, level: HlsLevelSelection): void {
  if (level === "auto") {
    hls.currentLevel = -1
    return
  }
  const index = hls.levels.findIndex((candidate) => candidate.height === level)
  // Unknown height (e.g. manifest changed) falls back to adaptive rather than
  // pinning an out-of-range index.
  hls.currentLevel = index >= 0 ? index : -1
}

/**
 * Binds a media `spec` to the video element and returns the `src` to set on it
 * (or `null` when an attached engine drives the element instead).
 *
 * - `url`/`file`: progressive playback via a plain `src`.
 * - `hls` with MSE: hls.js is attached (no `src`); `levelHeight` selects the
 *   rendition and can change without tearing down playback.
 * - `hls` without MSE: native HLS via `src`, with browser-driven adaptation.
 */
export function useMediaEngine(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  spec: SourceSpec,
  levelHeight: HlsLevelSelection,
  onFatalError?: (message: string) => void,
): { src: string | null } {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null)

  const hlsRef = React.useRef<HlsType | null>(null)
  const levelRef = React.useRef(levelHeight)
  levelRef.current = levelHeight
  const onFatalRef = React.useRef(onFatalError)
  onFatalRef.current = onFatalError

  // Object URL lifecycle for local File sources.
  React.useEffect(() => {
    if (spec.kind !== "file") {
      setObjectUrl(null)
      return
    }
    const url = createObjectUrl(spec.file, "media source URL")
    setObjectUrl(url)
    return () => revokeObjectUrl(url, "media source URL")
  }, [spec])

  // hls.js attach/detach. Re-runs only when the spec changes; manual level
  // selection is handled by the separate effect below so it never tears down
  // the engine (that is what makes quality switching seamless).
  const useHlsJs = spec.kind === "hls" && mseHlsSupported()
  const hlsUrl = spec.kind === "hls" ? spec.url : null
  React.useEffect(() => {
    if (!useHlsJs || !hlsUrl) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    let instance: HlsType | null = null

    import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) {
          onFatalRef.current?.("This browser cannot play adaptive streams.")
          return
        }
        instance = new Hls({ enableWorker: true })
        hlsRef.current = instance
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (instance) applyLevel(instance, levelRef.current)
        })
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          clientLogger.warn(`[hls] fatal error: ${data.details}`, data.error)
          onFatalRef.current?.("Adaptive stream failed.")
        })
        instance.loadSource(hlsUrl)
        instance.attachMedia(video)
      })
      .catch((cause) => {
        clientLogger.warn("[hls] failed to load hls.js", cause)
        onFatalRef.current?.("Adaptive stream failed to load.")
      })

    return () => {
      cancelled = true
      instance?.destroy()
      if (hlsRef.current === instance) hlsRef.current = null
    }
  }, [useHlsJs, hlsUrl, videoRef])

  // Apply manual level changes to a live hls.js instance without reloading.
  React.useEffect(() => {
    const hls = hlsRef.current
    if (hls) applyLevel(hls, levelHeight)
  }, [levelHeight])

  let src: string | null = null
  if (spec.kind === "url") src = spec.url
  else if (spec.kind === "file") src = objectUrl
  else if (spec.kind === "hls" && !useHlsJs) src = spec.url

  return { src }
}
