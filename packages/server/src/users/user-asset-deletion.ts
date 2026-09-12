import { USER_ASSET_PATH_PREFIX } from "@alloy/contracts"
import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import { userAssetKey, type UserAssetRole } from "@alloy/server/storage/driver"

export const USER_ASSET_ROUTE_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:avatar|banner)-[0-9a-f]{32}\.webp$/i

export function internalUserAssetKey(
  publicUrl: string | null,
  userId: string,
  role: UserAssetRole,
): string | null {
  if (!publicUrl) return null
  const base = publicUrl.split("?", 1)[0]
  if (!base?.startsWith(USER_ASSET_PATH_PREFIX)) return null
  const key = base.slice(USER_ASSET_PATH_PREFIX.length)
  const roleBase = userAssetKey(userId, role, "").toLowerCase()
  const normalized = key.toLowerCase()
  if (!normalized.startsWith(`${roleBase}-`)) return null
  const versionAndExtension = normalized.slice(roleBase.length + 1)
  return /^[0-9a-f]{32}\.webp$/.test(versionAndExtension) ? key : null
}

export function userAssetConditionalUploadMatches(
  currentUrl: string | null,
  currentRevision: string,
  expected?: { currentUrl: string | null; revision: string },
): boolean {
  return (
    expected === undefined ||
    (currentUrl === expected.currentUrl &&
      currentRevision === expected.revision)
  )
}

export function userAssetDeletionIntents(input: {
  userId: string
  role: UserAssetRole
  previousUrl: string | null
  retainedKey?: string | null
  reason: string
  source: { type: string; id?: string | null }
}): StorageDeletionInput[] {
  const key = internalUserAssetKey(input.previousUrl, input.userId, input.role)
  if (!key || key.toLowerCase() === input.retainedKey?.toLowerCase()) return []
  return [
    { namespace: "assets", key, reason: input.reason, source: input.source },
  ]
}
