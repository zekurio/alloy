import type {
  ClipPage,
  ContractJsonInput,
  TagClipsParams,
  TagGamesResponse,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import { validateClipPage, validateGameListRows } from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"
import {
  objectRecord,
  validateNonNegativeInteger,
  validateStringArray,
} from "./runtime-validation"

export type { TagClipsParams, TagGamesResponse } from "@alloy/contracts"

function validateTagGamesResponse(value: ContractJsonInput): TagGamesResponse {
  const payload = objectRecord(value, "tag games")
  const clipCount = payload.clipCount
  validateNonNegativeInteger(
    clipCount,
    "Invalid tag games response: clipCount must be a non-negative integer",
  )
  return {
    clipCount,
    games: validateGameListRows(payload.games),
  }
}

function validateTagSuggestions(value: ContractJsonInput): string[] {
  return validateStringArray(
    objectRecord(value, "tag search").tags,
    "Invalid tag search response: tags must be an array of strings",
  )
}

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
      return readJsonOrThrow(res, validateClipPage)
    },
    async fetchSummary(tag: string): Promise<TagGamesResponse> {
      const res = await tags[":tag"].games.$get({ param: { tag } })
      return readJsonOrThrow(res, validateTagGamesResponse)
    },
    async search(query: string, signal?: AbortSignal): Promise<string[]> {
      const res = await tags.$get({ query: { q: query } }, { init: { signal } })
      return readJsonOrThrow(res, validateTagSuggestions)
    },
  }
}
