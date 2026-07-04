const VIDEO_EVENT_TIMEOUT_MS = 15000

/**
 * Await a media element event with a timeout, rejecting on element errors.
 * Shared by everything that samples frames from a detached element
 * (filmstrip, capture poster, upload thumbnail capture).
 */
export function videoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata" | "seeked",
  opts?: { failureMessage?: string; alreadyDone?: () => boolean },
): Promise<void> {
  if (opts?.alreadyDone?.()) return Promise.resolve()

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
      const detail = video.error?.message
      const fallback = opts?.failureMessage ?? "Video element error"
      reject(new Error(detail ? `${fallback}: ${detail}` : fallback))
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(
        new Error(opts?.failureMessage ?? `Timed out waiting for ${eventName}`),
      )
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

/**
 * JPEG-encode a canvas, resolving null on failure — including the
 * synchronous SecurityError a tainted canvas throws (cross-origin media
 * without CORS headers).
 */
export function canvasJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality)
  }).catch(() => null)
}

/**
 * Draw the element's current frame to a canvas scaled to at most `height`
 * and JPEG-encode it. Returns null when no frame is decodable — an
 * unsupported codec parses metadata but never decodes a frame, and drawing
 * would only produce black cells.
 */
export async function drawVideoFrameJpeg(
  video: HTMLVideoElement,
  opts: { height: number; quality: number },
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  if (!srcW || !srcH) return null

  const canvas = document.createElement("canvas")
  canvas.height = Math.min(opts.height, srcH)
  canvas.width = Math.max(1, Math.round((srcW / srcH) * canvas.height))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  const blob = await canvasJpegBlob(canvas, opts.quality)
  if (!blob) return null
  return { blob, width: canvas.width, height: canvas.height }
}
