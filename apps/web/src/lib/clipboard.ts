import { clientLogger } from "./client-log"

interface CopyTextOptions {
  action?: string
  dedupeKey?: string
}

const loggedClipboardFailures = new Set<string>()

function logClipboardFailure(
  action: string,
  dedupeKey: string,
  cause: unknown,
) {
  if (loggedClipboardFailures.has(dedupeKey)) return
  loggedClipboardFailures.add(dedupeKey)
  clientLogger.warn(`[clipboard] Failed to ${action}.`, cause)
}

export async function copyTextToClipboard(
  text: string,
  options: CopyTextOptions = {},
): Promise<boolean> {
  const action = options.action ?? "copy text"
  const dedupeKey = options.dedupeKey ?? action
  const clipboard = globalThis.navigator?.clipboard

  if (!clipboard || typeof clipboard.writeText !== "function") {
    logClipboardFailure(
      action,
      dedupeKey,
      new Error("Clipboard API is not available."),
    )
    return false
  }

  try {
    await clipboard.writeText(text)
    return true
  } catch (cause) {
    logClipboardFailure(action, dedupeKey, cause)
    return false
  }
}
