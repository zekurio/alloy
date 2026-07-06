import { useCallback, useState } from "react"

export type ImageLoadStatus = "idle" | "loading" | "loaded" | "error"

type ImageLoadState = {
  src: string | null | undefined
  status: ImageLoadStatus
}

const loadedImageSrcs = new Set<string>()

function statusForSrc(src: string | null | undefined): ImageLoadStatus {
  if (!src) return "idle"
  return loadedImageSrcs.has(src) ? "loaded" : "loading"
}

/**
 * Tracks whether the <img> rendering `src` has a decoded frame, so a
 * placeholder underneath can fade out. The state is scoped to the current src
 * during render, while a module-level loaded-src cache lets already-painted
 * images remount without flashing their placeholder.
 */
export function useImageLoaded(src: string | null | undefined) {
  const [state, setState] = useState<ImageLoadState>(() => ({
    src,
    status: statusForSrc(src),
  }))

  const status = state.src === src ? state.status : statusForSrc(src)

  const setStatus = useCallback(
    (nextStatus: ImageLoadStatus) => {
      if (!src) {
        setState((current) =>
          current.src === src && current.status === "idle"
            ? current
            : { src, status: "idle" },
        )
        return
      }

      if (nextStatus === "loaded") {
        loadedImageSrcs.add(src)
      }

      const resolvedStatus =
        nextStatus === "loading" && loadedImageSrcs.has(src)
          ? "loaded"
          : nextStatus
      setState((current) =>
        current.src === src && current.status === resolvedStatus
          ? current
          : { src, status: resolvedStatus },
      )
    },
    [src],
  )

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!src || !img || !img.complete || img.naturalWidth <= 0) return
      loadedImageSrcs.add(src)
      setState((current) =>
        current.src === src && current.status === "loaded"
          ? current
          : { src, status: "loaded" },
      )
    },
    [src],
  )

  const markLoaded = useCallback(() => setStatus("loaded"), [setStatus])
  const markError = useCallback(() => setStatus("error"), [setStatus])

  return {
    ref,
    status,
    loaded: status === "loaded",
    markLoaded,
    markError,
    setStatus,
  }
}
