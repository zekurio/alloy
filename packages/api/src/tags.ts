import type {
  ClipPage,
  GameListRow,
  TagClipsParams,
  TagGamesResponse,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import { validateClipPage, validateGameListRows } from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"

export type { TagClipsParams, TagGamesResponse } from "@alloy/contracts"

async function fetchTagClipPage(
  context: ApiContext,
  tag: string,
  params: TagClipsParams = {},
): Promise<ClipPage> {
  const res = await context.rpc.api.tags[":tag"].clips.$get({
    param: { tag },
    query: queryParams({
      sort: params.sort,
      window: params.window,
      igdbId: params.igdbId,
      limit: params.limit,
      cursor: params.cursor,
    }),
  })
  return readJsonOrThrow(res, validateClipPage)
}

async function fetchTagGames(
  context: ApiContext,
  tag: string,
): Promise<GameListRow[]> {
  const res = await context.rpc.api.tags[":tag"].games.$get({
    param: { tag },
  })
  const payload = await readJsonOrThrow(
    res,
    (value): TagGamesResponse => ({
      games: validateGameListRows((value as { games: unknown }).games),
    }),
  )
  return payload.games
}

function validateTagSuggestions(value: unknown): string[] {
  const tags = (value as { tags?: unknown }).tags
  if (!Array.isArray(tags)) {
    throw new Error("Invalid tag search response: tags must be an array")
  }
  return tags.map((tag) => {
    if (typeof tag !== "string") {
      throw new Error("Invalid tag search response: tag must be a string")
    }
    return tag
  })
}

async function searchTags(
  context: ApiContext,
  query: string,
): Promise<string[]> {
  const res = await context.rpc.api.tags.$get({ query: { q: query } })
  return readJsonOrThrow(res, validateTagSuggestions)
}

export function createTagsApi(context: ApiContext) {
  return {
    fetchClipPage: (tag: string, params: TagClipsParams = {}) =>
      fetchTagClipPage(context, tag, params),
    fetchGames: (tag: string) => fetchTagGames(context, tag),
    search: (query: string) => searchTags(context, query),
  }
}
