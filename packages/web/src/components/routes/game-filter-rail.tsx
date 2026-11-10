import { t } from "@alloy/i18n"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { GlobeIcon } from "lucide-react"
import type { ReactElement } from "react"

import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"

const ALL_GAMES = "__all"

type GameChip = {
  name: string
  iconUrl: string | null
  logoUrl: string | null
}

/**
 * An "All games" chip followed by one chip per game. Each chip links to the
 * page with `game` set to that game's key, or unset for "All games".
 */
export function GameFilterRail<G extends GameChip>({
  games,
  gameKey,
  activeGame,
  renderLink,
}: {
  games: ReadonlyArray<G>
  /** The value the page's `game` search param uses for this game. */
  gameKey: (game: G) => string
  activeGame: string | null
  renderLink: (game: string | undefined) => ReactElement
}) {
  const options: FilterChipOption<string>[] = [
    { key: ALL_GAMES, label: t("All games"), icon: <GlobeIcon /> },
    ...games.map((game) => ({
      key: gameKey(game),
      label: game.name,
      icon: <GameIcon src={game.iconUrl ?? game.logoUrl} name={game.name} />,
    })),
  ]

  return (
    <FilterChipRail
      options={options}
      activeKey={activeGame ?? ALL_GAMES}
      renderOptionLink={(option) =>
        renderLink(option.key === ALL_GAMES ? undefined : option.key)
      }
    />
  )
}
