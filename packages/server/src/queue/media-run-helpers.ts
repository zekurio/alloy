import { mkdir, mkdtemp, rm } from "node:fs/promises"

import { MEDIA_CACHE_DIR } from "@alloy/server/runtime/dirs"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"

export async function makeMediaWorkDir(id: string): Promise<string> {
  await mkdir(MEDIA_CACHE_DIR, { recursive: true })
  return mkdtemp(`${MEDIA_CACHE_DIR}/${id}-`)
}

/**
 * Materialize a committed clip source into a scratch work dir, run `fn`
 * against it, and clean up regardless of outcome. Shared by the one-shot
 * source consumers (poster route, scrubber sheet, probe backfill).
 */
export async function withClipSourceWorkDir<T>(
  label: string,
  sourceKey: string,
  fn: (paths: { workDir: string; sourcePath: string }) => Promise<T>,
): Promise<T> {
  const workDir = await makeMediaWorkDir(label)
  try {
    const sourcePath = join(workDir, "source")
    await clipStorage.downloadToFile(sourceKey, sourcePath)
    return await fn({ workDir, sourcePath })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
