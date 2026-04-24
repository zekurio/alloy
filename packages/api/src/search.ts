import type { ApiContext } from "./client"
import type { SearchResults } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type { SearchResults, UserListRow } from "@workspace/contracts"

export function createSearchApi(context: ApiContext) {
  return {
    async fetch(query: string, limit = 8): Promise<SearchResults> {
      const res = await context.request("/api/search", {
        query: { q: query, limit: String(limit) },
      })
      return readJsonOrThrow<SearchResults>(res)
    },
  }
}
