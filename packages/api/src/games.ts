import type {
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  booleanFlagResponseValidator,
  validateGameDetail,
  validateGameListRows,
  validateGameNameLookupResponse,
  validateGameRow,
  validateSteamGridDBSearchResults,
  validateSteamGridDBStatus,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readPostDeleteJson } from "./mutations"
import { queryParams } from "./paths"

export type {
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
  params: { limit?: number; offset?: number } = {},
): Promise<GameListRow[]> {
  const res = await context.rpc.api.games.$get({
    query: queryParams(params),
  })
  return readJsonOrThrow(res, validateGameListRows)
}

async function fetchGameById(
  context: ApiContext,
  gameId: number | string,
): Promise<GameDetail> {
  const res = await context.rpc.api.games[":slug"].$get({
    param: { slug: String(gameId) },
  })
  return readJsonOrThrow(res, validateGameDetail)
}

async function setGameFollow(
  context: ApiContext,
  gameId: number | string,
  following: true,
): Promise<{ following: true }>
async function setGameFollow(
  context: ApiContext,
  gameId: number | string,
  following: false,
): Promise<{ following: false }>
async function setGameFollow(
  context: ApiContext,
  gameId: number | string,
  following: boolean,
): Promise<{ following: boolean }> {
  const response = await readPostDeleteJson(
    following,
    {
      post: () =>
        context.rpc.api.games[":slug"].follow.$post({
          param: { slug: String(gameId) },
        }),
      delete: () =>
        context.rpc.api.games[":slug"].follow.$delete({
          param: { slug: String(gameId) },
        }),
    },
    booleanFlagResponseValidator("following", following),
  )
  return { following: response.following }
}

export function createGamesApi(context: ApiContext) {
  return {
    fetchSteamGridDBStatus: () => fetchSteamGridDBStatus(context),
    search: (query: string) => searchGames(context, query),
    resolve: (steamgriddbId: number) => resolveGame(context, steamgriddbId),
    lookupByNames: (names: string[]) => lookupGamesByName(context, names),
    fetchAll: (params: { limit?: number; offset?: number } = {}) =>
      fetchAllGames(context, params),
    fetchById: (gameId: number | string) => fetchGameById(context, gameId),
    fetchBySlug: (slug: string) => fetchGameById(context, slug),
    favorite: (gameId: number | string) => setGameFollow(context, gameId, true),
    unfavorite: (gameId: number | string) =>
      setGameFollow(context, gameId, false),
    follow: (gameId: number | string) => setGameFollow(context, gameId, true),
    unfollow: (gameId: number | string) =>
      setGameFollow(context, gameId, false),
  }
}
