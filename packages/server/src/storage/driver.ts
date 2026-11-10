import type { GameAssetRole } from "@alloy/contracts"

export interface ResolvedObject {
  stream: (opts?: {
    start?: number
    end?: number
  }) => ReadableStream<Uint8Array>
  /** Byte length of the full object — used to compute Content-Length. */
  size: number
  /** Stored `Content-Type`. The clip row carries the same value but the
   * driver gets to be the source of truth at read time. */
  contentType: string
  /** Last modification time, when the driver knows it; null otherwise. */
  lastModified: Date | null
}

export interface WriteUploadPartInput {
  key: string
  partNumber: number
  partSizeBytes: number
  maxBytes: number
  body: ReadableStream<Uint8Array>
}

export interface CompleteUploadInput {
  key: string
  maxBytes: number
  partSizeBytes: number
}

export interface AbortUploadInput {
  key: string
}

export function clipAssetDir(clipId: string): string {
  const hex = clipId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  // Keys are relative to the configured clip-store root, which already means
  // "clips", so no `clips/` prefix here.
  return `${aa}/${bb}/${clipId}`
}

// Shared by user and game assets: both are sharded by id under the same
// configured assets root. The `users` vs `games` distinction lives in
// the URL prefix (USER_ASSET_PATH_PREFIX / GAME_ASSET_PATH_PREFIX) and the
// serving route, not in the key shape, which the key-validation regexes in
// users-upload.ts and admin-games.ts assume is bare `aa/bb/<id>/<role>.ext`.
function shardedAssetDir(id: string): string {
  const hex = id.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  return `${aa}/${bb}/${id}`
}

export type UserAssetRole = "avatar" | "banner"

export function versionedAssetKey(
  id: string,
  role: UserAssetRole | GameAssetRole,
  versionId: string,
): string {
  const version = versionId.replaceAll("-", "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(version)) {
    throw new Error("Asset version must be a UUID")
  }
  return `${shardedAssetDir(id)}/${role}-${version}.webp`
}

/** Key prefix shared by every version of one user or game asset role. */
export function assetRoleKeyBase(
  id: string,
  role: UserAssetRole | GameAssetRole,
): string {
  return `${shardedAssetDir(id)}/${role}`
}
