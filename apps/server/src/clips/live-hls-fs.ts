import { readdir, stat, access } from "node:fs/promises"

import { join } from "../runtime/path"

export async function dirSize(path: string): Promise<number> {
  let total = 0
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await dirSize(child)
    else total += (await stat(child).catch(() => null))?.size ?? 0
  }
  return total
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function fileSizeOrZero(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}
