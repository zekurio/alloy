import type {
  GameNameLookupResponse,
  GameNameLookupResult,
  GameRow,
  SteamGridDBSearchResult,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import {
  exactNameKey,
  normalizedNameKey,
  uniqueLookupNames,
} from "./name-match"
import {
  getSteamGridGameRef,
  type IndexedGameNameLookupCandidate,
  lookupIndexedGamesByName,
} from "./ref"
import { gameRowFromSearchResult, searchGames } from "./steamgriddb"

const logger = createLogger("games")

const GAME_NAME_LOOKUP_MAX = 50

export async function lookupGamesByName(
  names: string[],
  viewerId: string | null,
): Promise<GameNameLookupResponse> {
  const queries = uniqueLookupNames(names, GAME_NAME_LOOKUP_MAX)
  if (queries.length === 0) return { results: [] }

  const indexedByName = await lookupIndexedGamesByName(queries, viewerId)

  return {
    results: await Promise.all(
      queries.map((name) =>
        lookupGameByName(name, indexedByName.get(exactNameKey(name)) ?? []),
      ),
    ),
  }
}

/**
 * Resolve a detected game name to a game row that is GUARANTEED to be persisted
 * in the local `game` table (inserted on first use), so the id is safe to use
 * in a foreign key (clips, staging recordings, game sessions). Returns null
 * when there's no confident match or the game can't be persisted.
 *
 * The desktop only knows a process name, never a SteamGridDB id, so the server
 * owns this name->game resolution. `lookupGamesByName` alone can return a match
 * built from a SteamGridDB search result that was never stored; routing through
 * `getSteamGridGameRef` is what actually writes the row.
 */
export async function resolvePersistedGameByName(
  name: string,
  viewerId: string | null,
): Promise<GameRow | null> {
  try {
    const { results } = await lookupGamesByName([name], viewerId)
    const match = results[0]?.game
    if (!match) return null
    return await getSteamGridGameRef(match.steamgriddbId)
  } catch (err) {
    logger.warn(`game name resolution failed for "${name}":`, err)
    return null
  }
}

async function lookupGameByName(
  name: string,
  indexed: IndexedGameNameLookupCandidate[],
): Promise<GameNameLookupResult> {
  const indexedExact = confidentIndexedMatch(indexed, "exact")
  if (indexedExact) {
    return indexedResult(name, indexedExact.game, "indexed-exact-name")
  }

  let steamGridResults: SteamGridDBSearchResult[]
  try {
    steamGridResults = uniqueSearchResults(await searchGames(name))
  } catch (err) {
    logger.warn(`SteamGridDB lookup failed for "${name}":`, err)
    return fallbackIndexedOrNoMatch(name, indexed)
  }

  const exact = steamGridResults.filter(
    (result) => exactNameKey(result.name) === exactNameKey(name),
  )
  const exactSteamGrid = await steamGridResult(name, exact, indexed)
  if (exactSteamGrid) return exactSteamGrid

  const indexedNormalized = confidentIndexedMatch(indexed, "normalized")
  if (indexedNormalized) {
    return indexedResult(
      name,
      indexedNormalized.game,
      "indexed-normalized-name",
    )
  }

  const normalized = steamGridResults.filter(
    (result) => normalizedNameKey(result.name) === normalizedNameKey(name),
  )
  const normalizedSteamGrid = await steamGridResult(name, normalized, indexed)
  if (normalizedSteamGrid) return normalizedSteamGrid

  if (exact.length > 1 || normalized.length > 1 || indexed.length > 1) {
    return { name, game: null, confidence: 0, reason: "ambiguous" }
  }

  return { name, game: null, confidence: 0, reason: "no-match" }
}

function fallbackIndexedOrNoMatch(
  name: string,
  indexed: IndexedGameNameLookupCandidate[],
): GameNameLookupResult {
  const indexedExact = confidentIndexedMatch(indexed, "exact")
  if (indexedExact) {
    return indexedResult(name, indexedExact.game, "indexed-exact-name")
  }

  const indexedNormalized = confidentIndexedMatch(indexed, "normalized")
  if (indexedNormalized) {
    return indexedResult(
      name,
      indexedNormalized.game,
      "indexed-normalized-name",
    )
  }

  return {
    name,
    game: null,
    confidence: 0,
    reason: indexed.length > 1 ? "ambiguous" : "no-match",
  }
}

function indexedResult(
  name: string,
  game: GameRow,
  reason: "indexed-exact-name" | "indexed-normalized-name",
): GameNameLookupResult {
  return {
    name,
    game,
    confidence: 1,
    reason,
  }
}

async function steamGridResult(
  name: string,
  results: SteamGridDBSearchResult[],
  indexed: IndexedGameNameLookupCandidate[],
): Promise<GameNameLookupResult | null> {
  if (results.length === 0) return null

  const indexedTieBreak = confidentIndexedMatch(
    indexed.filter((candidate) =>
      results.some((result) => result.id === candidate.game.steamgriddbId),
    ),
    "any",
  )
  if (indexedTieBreak) {
    return indexedResult(
      name,
      indexedTieBreak.game,
      indexedTieBreak.exact ? "indexed-exact-name" : "indexed-normalized-name",
    )
  }

  if (results.length !== 1) return null

  return {
    name,
    game: await gameRowFromSearchResult(results[0]),
    confidence: 1,
    reason:
      exactNameKey(results[0].name) === exactNameKey(name)
        ? "steamgriddb-exact-name"
        : "steamgriddb-normalized-name",
  }
}

function confidentIndexedMatch(
  candidates: IndexedGameNameLookupCandidate[],
  mode: "exact" | "normalized" | "any",
): IndexedGameNameLookupCandidate | null {
  const matches = candidates.filter((candidate) => {
    if (mode === "any") return true
    return mode === "exact" ? candidate.exact : candidate.normalized
  })
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]

  const personalMatches = matches.filter(
    (candidate) => candidate.personalScore > 0,
  )
  const personal = uniqueBestScore(personalMatches)
  if (personal) return personal

  const indexed = uniqueBestScore(
    matches.filter((candidate) => candidate.score > 0),
  )
  if (indexed) return indexed

  return null
}

function uniqueBestScore(
  candidates: IndexedGameNameLookupCandidate[],
): IndexedGameNameLookupCandidate | null {
  if (candidates.length === 0) return null

  const [first, second] = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.game.name.localeCompare(b.game.name)
  })
  if (!first) return null
  if (!second || first.score > second.score) return first
  return null
}

function uniqueSearchResults(
  results: SteamGridDBSearchResult[],
): SteamGridDBSearchResult[] {
  const seen = new Set<number>()
  const unique: SteamGridDBSearchResult[] = []
  for (const result of results) {
    if (seen.has(result.id)) continue
    seen.add(result.id)
    unique.push(result)
  }
  return unique
}
