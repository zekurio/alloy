import { useEffect, useRef, useState } from "react"

/**
 * Tracks whether the <img> rendering `src` has a decoded frame, so a
 * placeholder underneath can fade out. Seeds from the element for cached
 * images: the <img> can be `complete` before React attaches `onLoad`, so that
 * handler alone would never fire and the placeholder would cover an
 * already-painted image.
 */
export function useImageLoaded(src: string | null | undefined) {
  const ref = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!src) {
      setLoaded(false)
      return
    }
    const img = ref.current
    setLoaded(Boolean(img?.complete && img.naturalWidth > 0))
  }, [src])

  return { ref, loaded, markLoaded: () => setLoaded(true) }
}
