import { UNCATEGORISED_GAME_ID } from "@alloy/contracts"
import { t } from "@alloy/i18n"

export function gameDisplayName(game: { id: string; name: string }): string {
  return game.id === UNCATEGORISED_GAME_ID ? t("Uncategorised") : game.name
}
