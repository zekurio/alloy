const VIDEO_EVENT_TIMEOUT_MS = 15000

/**
 * Await a media element event with a timeout, rejecting on element errors.
 * Shared by the element-based frame samplers (filmstrip, capture poster).
 */
export function videoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener("error", onError)
    }
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(video.error?.message ?? "Video element error"))
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, VIDEO_EVENT_TIMEOUT_MS)
    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}

/** Detach the element's source and abort any in-flight loading. */
export function teardownVideoElement(video: HTMLVideoElement): void {
  video.removeAttribute("src")
  try {
    video.load()
  } catch {
    // Some mobile browsers throw while tearing down blob-backed media.
  }
}
