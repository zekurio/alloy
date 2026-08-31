import { GAME_ASSET_PATH_PREFIX, type GameAssetRole } from "@alloy/contracts"
import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import { gameAssetKey } from "@alloy/server/storage/driver"

export const GAME_ASSET_ROUTE_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:hero|grid|logo|icon)(?:-[0-9a-f]{32})?\.webp$/i

export function internalGameAssetKey(
  publicUrl: string | null,
  gameId: string,
  role: GameAssetRole,
): string | null {
  if (!publicUrl) return null
  const base = publicUrl.split("?", 1)[0]
  if (!base?.startsWith(GAME_ASSET_PATH_PREFIX)) return null
  const key = base.slice(GAME_ASSET_PATH_PREFIX.length)
  const roleBase = gameAssetKey(gameId, role, "").toLowerCase()
  const normalized = key.toLowerCase()
  if (normalized === `${roleBase}.webp`) return key
  if (!normalized.startsWith(`${roleBase}-`)) return null
  const versionAndExtension = normalized.slice(roleBase.length + 1)
  return /^[0-9a-f]{32}\.webp$/.test(versionAndExtension) ? key : null
}

export function gameAssetDeletionIntents(input: {
  gameId: string
  role: GameAssetRole
  previousUrl: string | null
  retainedKey?: string | null
  reason: string
  source: { type: string; id?: string | null }
  includeLegacyVariant?: boolean
}): StorageDeletionInput[] {
  const retained = input.retainedKey?.toLowerCase() ?? null
  const candidates = [
    internalGameAssetKey(input.previousUrl, input.gameId, input.role),
  ]
  if (input.includeLegacyVariant) {
    candidates.push(gameAssetKey(input.gameId, input.role, ".webp"))
  }

  const intents = new Map<string, StorageDeletionInput>()
  for (const key of candidates) {
    if (!key || key.toLowerCase() === retained) continue
    intents.set(key, {
      namespace: "assets",
      key,
      reason: input.reason,
      source: input.source,
    })
  }
  return [...intents.values()]
}
