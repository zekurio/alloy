import { createHash } from "node:crypto"

/**
 * Cache-busting version for a clip asset URL, derived from the storage key.
 * Published assets live under versioned (run-scoped) keys, so a key change is
 * exactly a byte change — the hash never has to touch the object itself.
 */
export function clipAssetVersion(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}
