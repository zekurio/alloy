import { clipAssetDir } from "@alloy/server/storage/driver"

/**
 * Published asset keys are scoped to the encode lease's runId so two runs
 * that ever overlap on the same clip (stale-lease takeover) can never write
 * or delete each other's objects. The previous object is pruned after the
 * new one is committed to the clip row.
 */
export function runScopedSourceKey(clipId: string, runId: string): string {
  return `${clipAssetDir(clipId)}/source-${runKeyStamp(runId)}`
}

export function runScopedThumbKey(clipId: string, runId: string): string {
  return `${clipAssetDir(clipId)}/thumb-${runKeyStamp(runId)}.jpg`
}

export function runScopedRenditionKey(
  clipId: string,
  runId: string,
  name: string,
): string {
  return `${clipAssetDir(clipId)}/rendition-${name}-${runKeyStamp(runId)}.mp4`
}

function runKeyStamp(runId: string): string {
  return runId.replace(/-/g, "").slice(0, 12)
}
