import { useEffect } from "react"

import { alloyDesktop, desktopSupports } from "@/lib/desktop"
import { desktopMediaFilmstrip } from "@/lib/media-filmstrip"

/**
 * Starts scrubber generation shortly after a newly saved desktop capture is
 * committed to the library. Work is serialized and automatically yields to
 * visible playback in the shared background-media scheduler.
 */
export function DesktopScrubberGenerator() {
  const desktop = alloyDesktop()

  useEffect(() => {
    if (!desktop || !desktopSupports("recording.saveLibraryCaptureScrubber")) {
      return
    }
    const timers = new Set<number>()
    const unsubscribe = desktop.recording.onEvent((event) => {
      if (event.type !== "capture-ready") return
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        void desktop.recording
          .getLibrary()
          .then((snapshot) => {
            const item = snapshot.items.find(
              (entry) => entry.filename === event.capture.filename,
            )
            if (item) return desktopMediaFilmstrip(desktop, item)
          })
          .catch(() => undefined)
      }, 250)
      timers.add(timer)
    })
    return () => {
      unsubscribe()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [desktop])

  return null
}
