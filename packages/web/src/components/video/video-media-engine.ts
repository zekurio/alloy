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
  /** Called when the active tier fails and a lower playable tier exists. */
  onFallback: (name: string) => void
}

/**
 * Resolve what the <video> element should actually play. File sources map to
 * an object URL; URL sources with renditions play the selected tier, falling
 * back to the best playable tier if the selection is missing or unplayable.
 * The player routes media element errors through `onMediaError`, which steps
 * down exactly one tier on a fatal decode/network error — there is no
 * stall/freeze detection or automatic upgrade. `mediaKey` identifies the
 * element's effective media: it changes exactly when the element will
 * reload, so the player can capture resume state.
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
            canPlaySource(source.contentType, source.codecs),
          )
        : [],
    [renditionPlayback, spec],
  )
  const sourcesKey = playable.map((source) => source.url).join("|")

  // A selected-but-unplayable or missing name falls back to the best
  // playable tier (index 0, since `sources` is ordered best-first).
  const active =
    playable.find((source) => source.name === renditionPlayback?.selected) ??
    playable[0] ??
    null
  const activeUrl = active?.url ?? null
  const activeIndex = active ? playable.indexOf(active) : -1

  const onMediaError = useCallback(() => {
    const next = activeIndex >= 0 ? playable[activeIndex + 1] : undefined
    if (!next) return false
    renditionPlayback?.onFallback(next.name)
    return true
  }, [activeIndex, playable, renditionPlayback])

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
