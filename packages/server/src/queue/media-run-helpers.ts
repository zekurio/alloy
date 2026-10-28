import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { env } from "@alloy/server/env"
import { clipStorage } from "@alloy/server/storage/index"
import { configuredFilesystemStoragePath } from "@alloy/server/storage/paths"

/**
 * Scratch space for media work: the sources a run reads and the files it
 * writes before publishing them. It sits inside the clip storage root, so
 * sources and outputs move in and out by hardlink rather than by copy; a
 * private /tmp, such as systemd's PrivateTmp, is a different mount. No
 * storage key points into it, and it never outlives the process.
 */
function mediaWorkRoot(): string {
  return resolve(
    configuredFilesystemStoragePath(env.storage, "clips"),
    ".media-work",
  )
}

export async function makeMediaWorkDir(id: string): Promise<string> {
  const root = mediaWorkRoot()
  await mkdir(root, { recursive: true })
  return mkdtemp(`${root}/${id}-`)
}

/**
 * Removes the scratch a killed process left behind. Runs before the media
 * worker starts and before the server takes requests, so no work dir is in
 * use.
 */
export async function clearMediaWorkDirs(): Promise<void> {
  await rm(mediaWorkRoot(), { recursive: true, force: true })
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
