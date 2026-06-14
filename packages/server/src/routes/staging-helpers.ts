import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  ACCEPTED_THUMB_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_PRIVACY,
  CLIP_TAG_MAX_LENGTH,
  CLIP_TAGS_MAX,
  CLIP_TITLE_MAX_LENGTH,
  RECORDING_KIND,
} from "@alloy/contracts"
import type { GameRow } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { resolvePersistedGameByName } from "@alloy/server/games/lookup"
import { getSteamGridGameRef } from "@alloy/server/games/ref"
import { isoDate } from "@alloy/server/runtime/date"
import { z } from "zod"

import {
  cursorDate,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import {
  limitQueryParam,
  optionalBlankToNullTrimmedString,
  requiredTrimmedString,
} from "./validation"

const logger = createLogger("staging")

const BLURHASH_PATTERN = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,120}$/

const TagsInput = z
  .array(z.string().max(CLIP_TAG_MAX_LENGTH + 1))
  .max(CLIP_TAGS_MAX)
  .optional()

export const StagingIdParam = z.object({ id: z.uuid() })

export const StagingListQuery = z.object({
  kind: z.enum(RECORDING_KIND).optional(),
  limit: limitQueryParam(100, 50),
  cursor: z.string().optional(),
})

export const InitiateStagingBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ACCEPTED_CLIP_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  kind: z.enum(RECORDING_KIND).default("clip"),
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  // Both game fields are optional for staging — game-less is the point.
  steamgriddbId: z.number().int().positive().optional(),
  gameName: z.string().trim().min(1).max(200).optional(),
  tags: TagsInput,
  thumbBlurHash: z.string().regex(BLURHASH_PATTERN).optional(),
  thumbContentType: z.enum(ACCEPTED_THUMB_CONTENT_TYPES).default("image/webp"),
  originDeviceId: z.uuid().optional(),
  gameSessionId: z.uuid().optional(),
})

export const UpdateStagingBody = z.object({
  kind: z.enum(RECORDING_KIND).optional(),
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH).optional(),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  steamgriddbId: z.number().int().positive().optional(),
  gameName: z.string().trim().min(1).max(200).optional(),
  clearGame: z.boolean().optional(),
  tags: TagsInput,
})

export const PublishStagingBody = z.object({
  steamgriddbId: z.number().int().positive().optional(),
  gameName: z.string().trim().min(1).max(200).optional(),
  privacy: z.enum(CLIP_PRIVACY).default("public"),
  title: requiredTrimmedString(CLIP_TITLE_MAX_LENGTH).optional(),
  description: optionalBlankToNullTrimmedString(CLIP_DESCRIPTION_MAX_LENGTH),
  tags: TagsInput,
  mentionedUserIds: z.array(z.uuid()).optional(),
})

export interface ResolvedGame {
  steamgriddbId: number | null
  game: string | null
}

/**
 * Best-effort game resolution for staging: a steamgriddbId is verified (falling
 * back to a name snapshot if SteamGridDB is down), a name is looked up, and an
 * unresolved name is kept as a display snapshot with a null id. Never throws —
 * a staging recording is valid with no game.
 */
export async function resolveStagingGame(
  input: { steamgriddbId?: number; gameName?: string },
  viewerId: string,
): Promise<ResolvedGame> {
  if (input.steamgriddbId != null) {
    // Persist the game so staging_recording.steamgriddb_id FK holds. If it
    // can't be persisted, keep the detected name as a snapshot with a null id
    // rather than referencing a row that doesn't exist.
    let ref: GameRow | null = null
    try {
      ref = await getSteamGridGameRef(input.steamgriddbId)
    } catch (err) {
      logger.warn(`game ref failed for ${input.steamgriddbId}:`, err)
    }
    if (ref) return { steamgriddbId: ref.steamgriddbId, game: ref.name }
    return { steamgriddbId: null, game: input.gameName ?? null }
  }
  if (input.gameName) {
    const game = await resolvePersistedGameByName(input.gameName, viewerId)
    if (game) return { steamgriddbId: game.steamgriddbId, game: game.name }
    // No confident/persistable match — keep the raw name, leave the id null.
    return { steamgriddbId: null, game: input.gameName }
  }
  return { steamgriddbId: null, game: null }
}

/**
 * Strict game resolution for publishing — a clip must point at a real game.
 * Returns null when neither a valid steamgriddbId nor a resolvable name was
 * supplied (the caller turns that into a 422).
 */
export async function resolvePublishGame(
  input: { steamgriddbId?: number; gameName?: string },
  viewerId: string,
): Promise<{ steamgriddbId: number; game: string } | null> {
  if (input.steamgriddbId != null) {
    try {
      const ref = await getSteamGridGameRef(input.steamgriddbId)
      if (ref) return { steamgriddbId: ref.steamgriddbId, game: ref.name }
    } catch (err) {
      logger.warn(`game ref failed for ${input.steamgriddbId}:`, err)
    }
    return null
  }
  if (input.gameName) {
    const game = await resolvePersistedGameByName(input.gameName, viewerId)
    if (game) return { steamgriddbId: game.steamgriddbId, game: game.name }
  }
  return null
}

type StagingCursor = { createdAt: Date; id: string }

export function parseStagingCursor(
  value: string | undefined,
): StagingCursor | null {
  if (!value) return null
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  const createdAt = cursorDate(payload.createdAt)
  const id = cursorRequiredString(payload.id)
  if (payload.v !== 1 || !createdAt || !id) return null
  return { createdAt, id }
}

export function encodeStagingCursor(row: {
  createdAt: Date | string
  id: string
}): string {
  return encodeCursorPayload({
    v: 1,
    createdAt: isoDate(row.createdAt),
    id: row.id,
  })
}
