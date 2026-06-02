import { clientLogger } from "./client-log"
import { createObjectUrl, scheduleObjectUrlRevoke } from "./object-url"

interface BrowserDownloadOptions {
  filename?: string
  rel?: string
}

export function startBrowserDownload(
  url: string,
  options: BrowserDownloadOptions = {}
): boolean {
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    if (options.filename) anchor.download = options.filename
    if (options.rel) anchor.rel = options.rel
    anchor.style.display = "none"
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    return true
  } catch (cause) {
    clientLogger.warn("[download] Failed to start browser download.", cause)
    return false
  }
}

export function startBlobDownload(blob: Blob, filename: string): boolean {
  const url = createObjectUrl(blob, "blob download URL")
  if (!url) return false
  const started = startBrowserDownload(url, { filename })
  scheduleObjectUrlRevoke(url, "blob download URL")
  return started
}
