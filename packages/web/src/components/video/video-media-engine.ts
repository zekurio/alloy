import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"

import { canPlaySource } from "@/lib/media-capability"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

export interface RenditionSource {
  name: string
  url: string
  /** RFC 6381 codec string; empty when unknown (assumed playable). */
  codecs: string
  /** Container MIME type, e.g. "video/mp4". */
  contentType: string
}

/** Progressive playback config, source entry first. */
export interface RenditionPlayback {
  /** Quality tiers, best first; index 0 is the source. */
  sources: RenditionSource[]
  /** Always a concrete name — no null/Auto. */
  selected: string
  /**
   * True when the viewer chose the tier from the quality menu. Pinned tiers
   * opt out of stall-based downgrades; fatal media errors still step down.
   */
  pinned: boolean
  /** Called when the active tier fails and a lower playable tier exists. */
  onFallback: (name: string) => void
}

/** Consecutive `waiting` events within the window that trigger a downgrade. */
const STALL_EVENT_LIMIT = 4
const STALL_EVENT_WINDOW_MS = 30_000
/** Playback frozen for this long while playing triggers a downgrade. */
const STALL_FREEZE_MS = 5_000
const STALL_POLL_MS = 1_000
/** Buffer misses right after a seek are normal, not a bandwidth signal. */
const SEEK_GRACE_MS = 1_000

/**
 * Capability-filtered tiers plus the effective active tier: the selected
 * name when playable, else the best playable tier (index 0, best-first),
 * else null. Shared by the engine and the player's quality menu so the
 * highlight always matches what actually plays.
 */
export function resolvePlayback(
  sources: RenditionSource[],
  selected: string,
): { playable: RenditionSource[]; active: RenditionSource | null } {
  const playable = sources.filter((source) =>
    canPlaySource(source.contentType, source.codecs),
  )
  const active =
    playable.find((source) => source.name === selected) ?? playable[0] ?? null
  return { playable, active }
}

/**
 * Resolve what the <video> element should actually play. File sources map to
 * an object URL; URL sources with renditions play the selected tier, falling
 * back to the best playable tier if the selection is missing or unplayable.
 * Two signals step down one playable tier (never up, fireshare-style): a
 * fatal media error routed through `onMediaError`, and — unless the viewer
 * pinned a tier — repeated buffering or a multi-second freeze during
 * playback. `mediaKey` identifies the element's effective media: it changes
 * exactly when the element will reload, so the player can capture resume
 * state.
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

  const { playable, active } = useMemo(
    () =>
      spec.kind === "url" && renditionPlayback
        ? resolvePlayback(renditionPlayback.sources, renditionPlayback.selected)
        : { playable: [], active: null },
    [renditionPlayback, spec],
  )
  const sourcesKey = playable.map((source) => source.url).join("|")
  const activeUrl = active?.url ?? null
  const activeIndex = active ? playable.indexOf(active) : -1

  const onMediaError = useCallback(() => {
    const next = activeIndex >= 0 ? playable[activeIndex + 1] : undefined
    if (!next) return false
    renditionPlayback?.onFallback(next.name)
    return true
  }, [activeIndex, playable, renditionPlayback])

  // Stall-based downgrade: repeated `waiting` events within a rolling window,
  // or playback frozen for several seconds, both signal that the active tier
  // outruns the connection. Suppressed for pinned tiers and around seeks
  // (keyframe-aligned buffer misses are normal), and paused in hidden tabs
  // where browsers throttle media on purpose.
  const stallFallbackName =
    !renditionPlayback?.pinned && activeIndex >= 0
      ? (playable[activeIndex + 1]?.name ?? null)
      : null
  const onFallback = renditionPlayback?.onFallback
  useEffect(() => {
    if (!stallFallbackName || !activeUrl || !onFallback) return
    const video = videoRef.current
    if (!video) return

    const stepDown = () => onFallback(stallFallbackName)

    let lastSeekAt = 0
    const onSeeking = () => {
      lastSeekAt = Date.now()
    }
    const waitingTimestamps: number[] = []
    const onWaiting = () => {
      if (video.paused || video.seeking) return
      const now = Date.now()
      if (now - lastSeekAt < SEEK_GRACE_MS) return
      waitingTimestamps.push(now)
      while (
        waitingTimestamps.length > 0 &&
        now - waitingTimestamps[0] > STALL_EVENT_WINDOW_MS
      ) {
        waitingTimestamps.shift()
      }
      if (waitingTimestamps.length >= STALL_EVENT_LIMIT) stepDown()
    }
    video.addEventListener("seeking", onSeeking)
    video.addEventListener("waiting", onWaiting)

    let lastTime = video.currentTime
    let frozenSince: number | null = null
    const poll = window.setInterval(() => {
      if (
        video.paused ||
        video.ended ||
        video.seeking ||
        document.hidden ||
        video.currentTime !== lastTime
      ) {
        lastTime = video.currentTime
        frozenSince = null
        return
      }
      frozenSince ??= Date.now()
      if (Date.now() - frozenSince >= STALL_FREEZE_MS) stepDown()
    }, STALL_POLL_MS)

    return () => {
      video.removeEventListener("seeking", onSeeking)
      video.removeEventListener("waiting", onWaiting)
      window.clearInterval(poll)
    }
  }, [activeUrl, onFallback, stallFallbackName, videoRef])

  // Surface a loading state while the element reloads for a rendition change
  // within the same source set (manual pin or a fallback step-down). New
  // clips reset load state through the player's mediaKey handling instead.
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
