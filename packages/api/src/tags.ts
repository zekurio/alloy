import type {
  ClipPage,
  TagClipsParams,
  TagGamesResponse,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"

export type { TagClipsParams, TagGamesResponse } from "@alloy/contracts"

export function createTagsApi(context: ApiContext) {
  const tags = context.rpc.api.tags

  return {
    async fetchClipPage(
      tag: string,
      params: TagClipsParams = {},
    ): Promise<ClipPage> {
      const res = await tags[":tag"].clips.$get({
        param: { tag },
        query: queryParams({
          sort: params.sort,
          gameId: params.gameId,
          limit: params.limit,
          cursor: params.cursor,
        }),
      })
      return readJsonOrThrow(res)
    },
    async fetchSummary(tag: string): Promise<TagGamesResponse> {
      const res = await tags[":tag"].games.$get({ param: { tag } })
      return readJsonOrThrow(res)
    },
    async search(query: string, signal?: AbortSignal): Promise<string[]> {
      const res = await tags.$get({ query: { q: query } }, { init: { signal } })
      return (await readJsonOrThrow(res)).tags
    },
  }
}
