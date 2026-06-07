import type { SearchResults } from "alloy-contracts"

import type { ApiContext } from "./client"
import { validateSearchResults } from "./contract-validators"
import { readJsonOrThrow } from "./http"

export type { SearchResults, UserListRow } from "alloy-contracts"

export function createSearchApi(context: ApiContext) {
  return {
    async fetch(query: string, limit = 8): Promise<SearchResults> {
      const res = await context.rpc.api.search.$get({
        query: { q: query, limit: String(limit) },
      })
      return readJsonOrThrow(res, validateSearchResults)
    },
  }
}
