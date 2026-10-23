import type {
  MediaFilter,
  GameCreatorsResponse,
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  SteamGridDBSearchResult,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateGameCreatorsResponse,
  validateGameDetail,
  validateGameListRows,
  validateGameNameLookupResponse,
  validateGameRow,
  validateGameRows,
  validateSteamGridDBSearchResults,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { queryParams } from "./paths"

export type {
  GameCreator,
  GameCreatorsResponse,
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameNameLookupResult,
  GameRow,
  SteamGridDBSearchResult,
} from "@alloy/contracts"

export function createGamesApi(context: ApiContext) {
  const games = context.rpc.api.games

  /** `/api/games/:slug` takes a slug or a SteamGridDB id. */
  async function fetchById(
    gameId: number | string,
    media: MediaFilter = "video",
  ): Promise<GameDetail> {
    const res = await games[":slug"].$get({
      query: { media },
      param: { slug: String(gameId) },
    })
    return readJsonOrThrow(res, validateGameDetail)
  }

  return {
    async search(
      query: string,
      signal?: AbortSignal,
    ): Promise<SteamGridDBSearchResult[]> {
      const res = await games.search.$get(
        { query: { q: query } },
        { init: { signal } },
      )
      return readJsonOrThrow(res, validateSteamGridDBSearchResults)
    },
    async localSearch(query: string, signal?: AbortSignal): Promise<GameRow[]> {
      const res = await games["local-search"].$get(
        { query: { q: query } },
        { init: { signal } },
      )
      return readJsonOrThrow(res, validateGameRows)
    },
    async resolve(steamgriddbId: number): Promise<GameRow> {
      const res = await games.resolve.$post({ json: { steamgriddbId } })
      return readJsonOrThrow(res, validateGameRow)
    },
    async lookupByNames(names: string[]): Promise<GameNameLookupResponse> {
      const res = await games.lookup.$post({ json: { names } })
      return readJsonOrThrow(res, validateGameNameLookupResponse)
    },
    async fetchAll(
      params: { limit?: number; offset?: number; media?: MediaFilter } = {},
    ): Promise<GameListRow[]> {
      const res = await games.$get({ query: queryParams(params) })
      return readJsonOrThrow(res, validateGameListRows)
    },
    fetchById,
    fetchBySlug: fetchById,
    async fetchCreators(
      gameId: number | string,
      limit?: number,
      media: MediaFilter = "video",
    ): Promise<GameCreatorsResponse> {
      const res = await games[":slug"].creators.$get({
        param: { slug: String(gameId) },
        query: queryParams({ limit, media }),
      })
      return readJsonOrThrow(res, validateGameCreatorsResponse)
    },
  }
}
