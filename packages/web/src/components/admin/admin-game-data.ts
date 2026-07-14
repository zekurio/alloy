import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import type { QueryClient } from "@tanstack/react-query"

import { adminKeys } from "@/lib/admin-query-keys"

export const GAME_ASSET_FIELDS: {
  role: GameAssetRole
  label: string
  description: string
}[] = [
  { role: "grid", label: t("Cover"), description: t("Vertical box art") },
  { role: "hero", label: t("Banner"), description: t("Wide page header") },
  { role: "logo", label: t("Logo"), description: t("Transparent wordmark") },
  { role: "icon", label: t("Icon"), description: t("Square app tile") },
]

export const GAME_ASSET_URL: Record<GameAssetRole, keyof AdminGameRow> = {
  grid: "gridUrl",
  hero: "heroUrl",
  logo: "logoUrl",
  icon: "iconUrl",
}

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
}

export function removeAdminGameCacheRow(
  queryClient: QueryClient,
  gameId: string,
): void {
  queryClient.setQueryData<AdminGameRow[]>(adminKeys.games(), (old) =>
    old?.filter((game) => game.id !== gameId),
  )
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
