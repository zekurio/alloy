import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"

import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

export interface RenditionSource {
  name: string
  url: string
  /** RFC 6381 codec string; empty when unknown (assumed playable). */
  codecs: string
}

/** Progressive playback config for sources that have committed renditions. */
export interface RenditionPlayback {
  /** Quality tiers, highest first. */
  sources: RenditionSource[]
  /** null = Auto (top tier + stall-based downgrade); a name pins that tier. */
  selected: string | null
}

/** Consecutive `waiting` events within the window that trigger a downgrade. */
const STALL_EVENT_LIMIT = 4
const STALL_EVENT_WINDOW_MS = 30_000
/** Playback frozen for this long while playing triggers a downgrade. */
const STALL_FREEZE_MS = 5_000
const STALL_POLL_MS = 1_000

/**
 * Resolve what the <video> element should actually play. File sources map to
 * an object URL; URL sources with renditions play the selected tier (or, on
 * Auto, the top playable tier with automatic stall-based downgrades). The
 * player must route media element errors through `onMediaError` so a failing
 * tier degrades to the next one. `mediaKey` identifies the element's
 * effective media: it changes exactly when the element will reload, so the
 * player can capture resume state.
 */
export function useMediaEngine(
  spec: SourceSpec,
  videoRef: RefObject<HTMLVideoElement | null>,
  renditionPlayback?: RenditionPlayback | null,
): {
  src: string | null
  mediaKey: string
  onMediaError: () => boolean
  switchingRendition: boolean
} {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [switchingRendition, setSwitchingRendition] = useState(false)

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

  const playable = useMemo(
    () =>
      spec.kind === "url" && renditionPlayback
        ? renditionPlayback.sources.filter((source) =>
            supportsSource(source.codecs),
          )
        : [],
    [renditionPlayback, spec],
  )
  const sourcesKey = playable.map((source) => source.url).join("|")

  // Auto-mode tier index, keyed by the source set so a new clip re-renders at
  // the top tier immediately instead of one effect pass later.
  const [autoState, setAutoState] = useState({ key: sourcesKey, index: 0 })
  const autoIndex = autoState.key === sourcesKey ? autoState.index : 0

  const selected = renditionPlayback?.selected ?? null
  const pinnedIndex = selected
    ? playable.findIndex((source) => source.name === selected)
    : -1
  const activeIndex =
    pinnedIndex >= 0
      ? pinnedIndex
      : Math.min(autoIndex, Math.max(0, playable.length - 1))
  const activeUrl = playable[activeIndex]?.url ?? null

  // Auto mode steps down one tier at a time. The last tier never loops back
  // to spec.url — that progressive fallback usually serves the same bytes.
  const canDowngrade = pinnedIndex === -1 && activeIndex < playable.length - 1
  const downgrade = useCallback(() => {
    setAutoState((current) => {
      const index = current.key === sourcesKey ? current.index : 0
      return { key: sourcesKey, index: index + 1 }
    })
  }, [sourcesKey])

  // Stall-based downgrade, Auto mode only: repeated `waiting` events within a
  // rolling window, or playback frozen for several seconds, both signal that
  // the current tier outruns the connection.
  useEffect(() => {
    if (!canDowngrade || !activeUrl) return
    const video = videoRef.current
    if (!video) return

    const waitingTimestamps: number[] = []
    const onWaiting = () => {
      if (video.paused) return
      const now = Date.now()
      waitingTimestamps.push(now)
      while (
        waitingTimestamps.length > 0 &&
        now - waitingTimestamps[0]! > STALL_EVENT_WINDOW_MS
      ) {
        waitingTimestamps.shift()
      }
      if (waitingTimestamps.length >= STALL_EVENT_LIMIT) downgrade()
    }
    video.addEventListener("waiting", onWaiting)

    let lastTime = video.currentTime
    let frozenSince: number | null = null
    const poll = window.setInterval(() => {
      if (video.paused || video.ended) {
        lastTime = video.currentTime
        frozenSince = null
        return
      }
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime
        frozenSince = null
        return
      }
      frozenSince ??= Date.now()
      if (Date.now() - frozenSince >= STALL_FREEZE_MS) downgrade()
    }, STALL_POLL_MS)

    return () => {
      video.removeEventListener("waiting", onWaiting)
      window.clearInterval(poll)
    }
  }, [activeUrl, canDowngrade, downgrade, videoRef])

  // Surface a loading state while the element reloads for a rendition change
  // within the same source set (manual pin or auto downgrade). New clips
  // reset load state through the player's mediaKey handling instead.
  const prevActiveRef = useRef<{ key: string; url: string } | null>(null)
  useEffect(() => {
    const previous = prevActiveRef.current
    prevActiveRef.current = activeUrl
      ? { key: sourcesKey, url: activeUrl }
      : null
    if (
      !activeUrl ||
      !previous ||
      previous.key !== sourcesKey ||
      previous.url === activeUrl
    ) {
      setSwitchingRendition(false)
      return
    }
    setSwitchingRendition(true)
    const video = videoRef.current
    const finish = () => setSwitchingRendition(false)
    const timer = window.setTimeout(finish, 5000)
    video?.addEventListener("canplay", finish, { once: true })
    return () => {
      window.clearTimeout(timer)
      video?.removeEventListener("canplay", finish)
    }
  }, [activeUrl, sourcesKey, videoRef])

  const onMediaError = useCallback(() => {
    if (!canDowngrade) return false
    downgrade()
    return true
  }, [canDowngrade, downgrade])

  if (spec.kind === "file") {
    return {
      src: objectUrl,
      mediaKey: objectUrl ? `file:${objectUrl}` : "file",
      onMediaError,
      switchingRendition: false,
    }
  }

  if (activeUrl !== null) {
    return {
      src: activeUrl,
      mediaKey: `url:${activeUrl}`,
      onMediaError,
      switchingRendition,
    }
  }

  return {
    src: spec.url,
    mediaKey: `url:${spec.url}`,
    onMediaError,
    switchingRendition: false,
  }
}

function supportsSource(codecs: string): boolean {
  if (!codecs || typeof document === "undefined") return true
  return (
    document
      .createElement("video")
      .canPlayType(`video/mp4; codecs="${codecs}"`) !== ""
  )
}
