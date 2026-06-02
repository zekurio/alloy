import { api } from "./api"
import { clientLogger } from "./client-log"

const loggedViewFailures = new Set<string>()

export function recordClipViewBestEffort(clipId: string): void {
  void api.clips.recordView(clipId).catch((cause) => {
    if (loggedViewFailures.has(clipId)) return
    loggedViewFailures.add(clipId)
    clientLogger.warn(
      `[clips] Failed to record view for clip ${clipId}.`,
      cause
    )
  })
}
