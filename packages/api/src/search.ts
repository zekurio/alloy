import type { ApiContext } from "./client"
import type { SearchResults } from "@workspace/db/contracts"
import { readJsonOrThrow } from "./http"

export type { SearchResults, UserListRow } from "@workspace/db/contracts"

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
