import type {
  ClipPage,
  ClipRow,
  GameClipsParams,
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameRow,
  GameTopClipsParams,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  booleanFlagResponseValidator,
  validateClipPage,
  validateClipRows,
  validateGameDetail,
  validateGameListRows,
  validateGameNameLookupResponse,
  validateGameRow,
  validateSteamGridDBSearchResults,
  validateSteamGridDBStatus,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readPostDeleteJson } from "./mutations"
import { encodedPathSegment, queryParams, resolvePublicUrl } from "./paths"

export type {
  GameClipsParams,
  GameDetail,
  GameListRow,
  GameNameLookupResponse,
  GameNameLookupResult,
  GameRow,
  GameTopClipsParams,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@alloy/contracts"

export function gameGridUrl(slug: string, origin?: string): string {
  return resolvePublicUrl(`/api/games/${encodedPathSegment(slug)}/grid`, origin)
}

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

async function fetchGameBySlug(
  context: ApiContext,
  slug: string,
): Promise<GameDetail> {
  const res = await context.rpc.api.games[":slug"].$get({
    param: { slug },
  })
  return readJsonOrThrow(res, validateGameDetail)
}

async function setGameFollow(
  context: ApiContext,
  slug: string,
  following: true,
): Promise<{ following: true }>
async function setGameFollow(
  context: ApiContext,
  slug: string,
  following: false,
): Promise<{ following: false }>
async function setGameFollow(
  context: ApiContext,
  slug: string,
  following: boolean,
): Promise<{ following: boolean }> {
  const response = await readPostDeleteJson(
    following,
    {
      post: () =>
        context.rpc.api.games[":slug"].follow.$post({ param: { slug } }),
      delete: () =>
        context.rpc.api.games[":slug"].follow.$delete({ param: { slug } }),
    },
    booleanFlagResponseValidator("following", following),
  )
  return { following: response.following }
}

async function fetchGameClips(
  context: ApiContext,
  slug: string,
  params: GameClipsParams = {},
): Promise<ClipRow[]> {
  return (await fetchGameClipPage(context, slug, params)).items
}

async function fetchGameClipPage(
  context: ApiContext,
  slug: string,
  params: GameClipsParams = {},
): Promise<ClipPage> {
  const res = await context.rpc.api.games[":slug"].clips.$get({
    param: { slug },
    query: queryParams({
      sort: params.sort,
      limit: params.limit,
      cursor: params.cursor,
    }),
  })
  return readJsonOrThrow(res, validateClipPage)
}

async function fetchGameTopClips(
  context: ApiContext,
  slug: string,
  params: GameTopClipsParams = {},
): Promise<ClipRow[]> {
  const res = await context.rpc.api.games[":slug"]["top-clips"].$get({
    param: { slug },
    query: queryParams({
      window: params.window,
      limit: params.limit,
    }),
  })
  return readJsonOrThrow(res, validateClipRows)
}

export function createGamesApi(context: ApiContext) {
  return {
    fetchSteamGridDBStatus: () => fetchSteamGridDBStatus(context),
    search: (query: string) => searchGames(context, query),
    resolve: (steamgriddbId: number) => resolveGame(context, steamgriddbId),
    lookupByNames: (names: string[]) => lookupGamesByName(context, names),
    fetchAll: (params: { limit?: number; offset?: number } = {}) =>
      fetchAllGames(context, params),
    fetchBySlug: (slug: string) => fetchGameBySlug(context, slug),
    favorite: (slug: string) => setGameFollow(context, slug, true),
    unfavorite: (slug: string) => setGameFollow(context, slug, false),
    follow: (slug: string) => setGameFollow(context, slug, true),
    unfollow: (slug: string) => setGameFollow(context, slug, false),
    fetchClips: (slug: string, params: GameClipsParams = {}) =>
      fetchGameClips(context, slug, params),
    fetchClipsPage: (slug: string, params: GameClipsParams = {}) =>
      fetchGameClipPage(context, slug, params),
    fetchTopClips: (slug: string, params: GameTopClipsParams = {}) =>
      fetchGameTopClips(context, slug, params),
  }
}
