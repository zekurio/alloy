/** Detach the element's source and abort any in-flight loading. */
export function teardownVideoElement(video: HTMLVideoElement): void {
  video.removeAttribute("src")
  try {
    video.load()
  } catch {
    // Some mobile browsers throw while tearing down blob-backed media.
  }
}
