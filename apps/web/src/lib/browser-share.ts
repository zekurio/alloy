import { copyTextToClipboard } from "./clipboard"
import { clientLogger } from "./client-log"

type ShareResult = "shared" | "copied" | "cancelled" | "failed"

interface ShareUrlOptions {
  title?: string
  action?: string
}

function isShareCancelled(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError"
}

export async function shareUrlWithFallback(
  url: string,
  options: ShareUrlOptions = {}
): Promise<ShareResult> {
  const action = options.action ?? "share link"
  const share = globalThis.navigator?.share

  if (typeof share === "function") {
    try {
      await share.call(globalThis.navigator, {
        title: options.title,
        url,
      })
      return "shared"
    } catch (cause) {
      if (isShareCancelled(cause)) return "cancelled"
      clientLogger.warn(`[share] Failed to ${action}.`, cause)
    }
  }

  const copied = await copyTextToClipboard(url, { action })
  return copied ? "copied" : "failed"
}
