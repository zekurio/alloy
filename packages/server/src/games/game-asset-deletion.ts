import { GAME_ASSET_PATH_PREFIX, type GameAssetRole } from "@alloy/contracts"
import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import {
  managedAssetDeletionIntents,
  type ManagedAssetDeletion,
} from "@alloy/server/storage/deletion-producers"

export const GAME_ASSET_ROUTE_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:hero|grid|logo|icon)-[0-9a-f]{32}\.webp$/i

export function gameAssetDeletionIntents(
  input: ManagedAssetDeletion<GameAssetRole> & { gameId: string },
): StorageDeletionInput[] {
  return managedAssetDeletionIntents(
    GAME_ASSET_PATH_PREFIX,
    input.gameId,
    input,
  )
}
