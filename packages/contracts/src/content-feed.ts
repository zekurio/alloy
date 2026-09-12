import type { ClipFeedSort, ClipListSort, ClipRow } from "./content-clips"
import type { GameListRow } from "./content-games"
import type { UserListRow, UserSummary } from "./content-users"
import type { MediaFilter } from "./shared"

export type FeedFilter = { media?: MediaFilter } & (
  | { kind: "all" }
  | { kind: "game"; gameId: string; authorId?: string }
)

export interface FeedPageParams {
  filter: FeedFilter
  excludeClipId?: string
  sort: ClipFeedSort
  limit?: number
  cursor?: string | null
}

export interface FeedPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface GameCreator extends UserSummary {
  clipCount: number
}

export interface GameCreatorsResponse {
  creators: GameCreator[]
}

export interface TagClipsParams {
  sort?: ClipListSort
  /** Narrow to a single game by surrogate id. */
  gameId?: string
  limit?: number
  cursor?: string | null
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}
