import type {
  MediaFilter,
  GameCreatorsResponse,
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
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
  validateSteamGridDBStatus,
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
  SteamGridDBStatus,
} from "@alloy/contracts"

async function fetchSteamGridDBStatus(
  context: ApiContext,
): Promise<SteamGridDBStatus> {
  const res = await context.rpc.api.games.status.$get()
  return readJsonOrThrow(res, validateSteamGridDBStatus)
}

async function searchGames(
  context: ApiContext,
  query: string,
): Promise<SteamGridDBSearchResult[]> {
  const res = await context.rpc.api.games.search.$get({
    query: { q: query },
  })
  return readJsonOrThrow(res, validateSteamGridDBSearchResults)
}

async function resolveGame(
  context: ApiContext,
  steamgriddbId: number,
): Promise<GameRow> {
  const res = await context.rpc.api.games.resolve.$post({
    json: { steamgriddbId },
  })
  return readJsonOrThrow(res, validateGameRow)
}

async function localSearchGames(
  context: ApiContext,
  query: string,
): Promise<GameRow[]> {
  const res = await context.rpc.api.games["local-search"].$get({
    query: { q: query },
  })
  return readJsonOrThrow(res, validateGameRows)
}

async function lookupGamesByName(
  context: ApiContext,
  names: string[],
): Promise<GameNameLookupResponse> {
  const res = await context.rpc.api.games.lookup.$post({
    json: { names },
  })
  return readJsonOrThrow(res, validateGameNameLookupResponse)
}

async function fetchAllGames(
  context: ApiContext,
  params: { limit?: number; offset?: number; media?: MediaFilter } = {},
): Promise<GameListRow[]> {
  const res = await context.rpc.api.games.$get({
    query: queryParams(params),
  })
  return readJsonOrThrow(res, validateGameListRows)
}

async function fetchGameById(
  context: ApiContext,
  gameId: number | string,
  media: MediaFilter = "video",
): Promise<GameDetail> {
  const res = await context.rpc.api.games[":slug"].$get({
    query: { media },
    param: { slug: String(gameId) },
  })
  return readJsonOrThrow(res, validateGameDetail)
}

async function fetchGameCreators(
  context: ApiContext,
  gameId: number | string,
  limit?: number,
  media: MediaFilter = "video",
): Promise<GameCreatorsResponse> {
  const res = await context.rpc.api.games[":slug"].creators.$get({
    param: { slug: String(gameId) },
    query: queryParams({ limit, media }),
  })
  return readJsonOrThrow(res, validateGameCreatorsResponse)
}

export function createGamesApi(context: ApiContext) {
  return {
    fetchSteamGridDBStatus: () => fetchSteamGridDBStatus(context),
    search: (query: string) => searchGames(context, query),
    localSearch: (query: string) => localSearchGames(context, query),
    resolve: (steamgriddbId: number) => resolveGame(context, steamgriddbId),
    lookupByNames: (names: string[]) => lookupGamesByName(context, names),
    fetchAll: (
      params: { limit?: number; offset?: number; media?: MediaFilter } = {},
    ) => fetchAllGames(context, params),
    fetchById: (gameId: number | string, media?: MediaFilter) =>
      fetchGameById(context, gameId, media),
    fetchBySlug: (slug: string, media?: MediaFilter) =>
      fetchGameById(context, slug, media),
    fetchCreators: (
      gameId: number | string,
      limit?: number,
      media?: MediaFilter,
    ) => fetchGameCreators(context, gameId, limit, media),
  }
}
