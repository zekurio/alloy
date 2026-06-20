import { createHash } from "node:crypto"

export function clipThumbnailVersion(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}
