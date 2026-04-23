import type { ApiContext } from "./client"
import type { ClipRow } from "./clips"
import type { GameListRow } from "./games"
import { readJsonOrThrow } from "./http"

export interface UserListRow {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
  clipCount: number
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}

export function createSearchApi(context: ApiContext) {
  return {
    async fetch(query: string, limit = 8): Promise<SearchResults> {
      const res = await context.client.api.search.$get({
        query: { q: query, limit: String(limit) },
      })
      return readJsonOrThrow<SearchResults>(res)
    },
  }
}
