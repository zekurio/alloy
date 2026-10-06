import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import type { QueryClient } from "@tanstack/react-query"

import { adminKeys } from "@/lib/admin-query-keys"
import { invalidateGameQueries } from "@/lib/game-queries"

export const GAME_ASSET_ROLES: GameAssetRole[] = [
  "grid",
  "hero",
  "logo",
  "icon",
]

export const GAME_ASSET_FIELDS = {
  grid: { label: t("Cover"), description: t("Vertical box art") },
  hero: { label: t("Banner"), description: t("Wide page header") },
  logo: { label: t("Logo"), description: t("Transparent wordmark") },
  icon: { label: t("Icon"), description: t("Square app tile") },
} satisfies Record<GameAssetRole, { label: string; description: string }>

export const GAME_ASSET_URL = {
  grid: "gridUrl",
  hero: "heroUrl",
  logo: "logoUrl",
  icon: "iconUrl",
} satisfies Record<GameAssetRole, keyof AdminGameRow>

export function setAdminGameCacheRow(
  queryClient: QueryClient,
  game: AdminGameRow,
): void {
  queryClient.setQueryData<AdminGameRow[]>(adminKeys.games(), (old) => {
    if (!old) return [game]
    return old.some((item) => item.id === game.id)
      ? old.map((item) => (item.id === game.id ? game : item))
      : [game, ...old]
  })
  void invalidateGameQueries(queryClient)
}

export function removeAdminGameCacheRow(
  queryClient: QueryClient,
  gameId: string,
): void {
  queryClient.setQueryData<AdminGameRow[]>(adminKeys.games(), (old) =>
    old?.filter((game) => game.id !== gameId),
  )
  void invalidateGameQueries(queryClient)
}

export function dateInputValue(releaseDate: string | null): string {
  if (!releaseDate) return ""
  const date = new Date(releaseDate)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

export function releaseDatePayload(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
