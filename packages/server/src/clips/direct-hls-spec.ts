import { createHash } from "node:crypto"

/**
 * Pure helpers for the direct-play HLS package: cache-key derivation and the
 * servable-filename allowlist. Kept free of env/storage imports so they are
 * unit-testable without a configured server.
 */

export const DIRECT_HLS_MASTER = "master.m3u8"

export const DIRECT_HLS_TARGET_DURATION_SEC = 6

// mediabunny's default output layout: master.m3u8 at the root, then
// playlist-{n}.m3u8 / init-{n}.* / segment-{n}-{k}.* alongside it. Everything
// is flat, so a strict filename allowlist doubles as traversal protection.
const SERVABLE_FILE_RE =
  /^(?:master\.m3u8|playlist-\d+\.m3u8|init-\d+\.(?:mp4|m4s)|segment-\d+-\d+\.(?:mp4|m4s))$/

export interface DirectHlsSpec {
  cacheKey: string
  clipId: string
  sourceKey: string
}

export function makeDirectHlsSpec(row: {
  id: string
  sourceKey: string
  sourceSizeBytes: number | null
  updatedAt: Date | string
}): DirectHlsSpec {
  const keyInput = {
    v: 1,
    clipId: row.id,
    sourceKey: row.sourceKey,
    sourceSizeBytes: row.sourceSizeBytes,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
    targetDuration: DIRECT_HLS_TARGET_DURATION_SEC,
  }
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(keyInput))
    .digest("hex")
    .slice(0, 32)
  return { cacheKey, clipId: row.id, sourceKey: row.sourceKey }
}

export function isServableDirectHlsFile(filename: string): boolean {
  return SERVABLE_FILE_RE.test(filename)
}

export function directHlsContentType(filename: string): string {
  return filename.endsWith(".m3u8")
    ? "application/vnd.apple.mpegurl"
    : "video/mp4"
}
