import { mkdir, mkdtemp, rm } from "node:fs/promises"

import { MEDIA_CACHE_DIR } from "@alloy/server/runtime/dirs"
import { clipStorage } from "@alloy/server/storage/index"

export async function makeMediaWorkDir(id: string): Promise<string> {
  await mkdir(MEDIA_CACHE_DIR, { recursive: true })
  return mkdtemp(`${MEDIA_CACHE_DIR}/${id}-`)
}

/**
 * Run `fn` against a committed clip source, read where it is stored rather
 * than copied, with a scratch work dir for its outputs that is removed
 * regardless of outcome. Shared by one-shot source readers such as the
 * poster route.
 */
export async function withClipSourceWorkDir<T>(
  label: string,
  sourceKey: string,
  fn: (paths: { workDir: string; sourcePath: string }) => Promise<T>,
): Promise<T> {
  const workDir = await makeMediaWorkDir(label)
  try {
    return await clipStorage.withLocalFile(sourceKey, (sourcePath) =>
      fn({ workDir, sourcePath }),
    )
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
