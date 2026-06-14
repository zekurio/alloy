import { mkdir, mkdtemp } from "node:fs/promises"

import { MEDIA_CACHE_DIR } from "@alloy/server/runtime/dirs"

export async function makeMediaWorkDir(id: string): Promise<string> {
  await mkdir(MEDIA_CACHE_DIR, { recursive: true })
  return mkdtemp(`${MEDIA_CACHE_DIR}/${id}-`)
}
