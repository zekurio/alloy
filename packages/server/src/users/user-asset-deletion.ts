import { USER_ASSET_PATH_PREFIX } from "@alloy/contracts"
import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import {
  managedAssetDeletionIntents,
  type ManagedAssetDeletion,
} from "@alloy/server/storage/deletion-producers"
import type { UserAssetRole } from "@alloy/server/storage/driver"

export const USER_ASSET_ROUTE_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:avatar|banner)-[0-9a-f]{32}\.webp$/i

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

export function userAssetDeletionIntents(
  input: ManagedAssetDeletion<UserAssetRole> & { userId: string },
): StorageDeletionInput[] {
  return managedAssetDeletionIntents(
    USER_ASSET_PATH_PREFIX,
    input.userId,
    input,
  )
}
