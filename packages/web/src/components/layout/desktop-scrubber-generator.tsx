import { useEffect } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { desktopMediaFilmstrip } from "@/lib/media-filmstrip"

/**
 * Starts scrubber generation shortly after a newly saved desktop capture is
 * committed to the library. Work is serialized and automatically yields to
 * visible playback in the shared background-media scheduler.
 */
export function DesktopScrubberGenerator() {
  const desktop = alloyDesktop()

  useEffect(() => {
    if (!desktop) return
    const timers = new Set<number>()
    const unsubscribe = desktop.recording.onEvent((event) => {
      if (event.type !== "capture-ready") return
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        void desktop.recording
          .getLibrary()
          .then((snapshot) => {
            const capturePath = comparablePath(event.capture.filename)
            const item = snapshot.items.find(
              (entry) => comparablePath(entry.filename) === capturePath,
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

/**
 * Library filenames are `resolve()`d by the scan, while the sidecar reports the
 * path OBS wrote, so the two can differ by separator alone. Compare them the
 * way the main process keys its capture manifest.
 */
function comparablePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}
