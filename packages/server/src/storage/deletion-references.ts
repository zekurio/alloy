import {
  GAME_ASSET_PATH_PREFIX,
  USER_ASSET_PATH_PREFIX,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import {
  clip,
  clipAudioTrack,
  clipRendition,
  game,
  type StorageDeletionNamespace,
  uploadTicket,
} from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { clipAssetDir, clipAssetKey } from "@alloy/server/storage/driver"
import { and, type AnyColumn, eq, isNotNull, or, sql } from "drizzle-orm"

export interface StorageDeletionReferenceSource {
  type: string
  id: string | null
}

/**
 * Re-check authoritative database ownership immediately before touching
 * storage. Producers still enqueue atomically with reference removal; this
 * guard protects against stale, duplicated, or manually inserted intents.
 * It does not serialize a later writer reusing the same physical key after
 * this check. Producers must publish immutable/versioned keys, or explicitly
 * coordinate key reuse with the deletion worker before adopting this ledger.
 */
export async function storageDeletionHasLiveReference(
  namespace: StorageDeletionNamespace,
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<boolean> {
  switch (namespace) {
    case "clips":
      return clipObjectHasLiveReference(key, source)
    case "thumbnails":
      return thumbnailHasLiveReference(key, source)
    case "assets":
      return assetHasLiveReference(key)
  }
}

async function clipObjectHasLiveReference(
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<boolean> {
  const ownerId = clipStorageKeyClipId(key)
  const differentActiveRun = activeRunReferenceCondition(source)
  const [clipRows, renditionRows, audioRows, ticketRows] = await Promise.all([
    db
      .select({ id: clip.id })
      .from(clip)
      .where(
        or(
          storageKeyMatches(clip.source_key, key),
          storageKeyMatches(clip.cut_key, key),
          ownerId
            ? and(
                eq(clip.id, ownerId),
                isNotNull(clip.encode_run_id),
                differentActiveRun,
              )
            : undefined,
        ),
      )
      .limit(1),
    db
      .select({ id: clipRendition.id })
      .from(clipRendition)
      .where(storageKeyMatches(clipRendition.storage_key, key))
      .limit(1),
    db
      .select({ clipId: clipAudioTrack.clip_id })
      .from(clipAudioTrack)
      .where(storageKeyMatches(clipAudioTrack.storage_key, key))
      .limit(1),
    db
      .select({ id: uploadTicket.id })
      .from(uploadTicket)
      .where(storageKeyMatches(uploadTicket.storage_key, key))
      .limit(1),
  ])
  return (
    clipRows.length > 0 ||
    renditionRows.length > 0 ||
    audioRows.length > 0 ||
    ticketRows.length > 0
  )
}

async function thumbnailHasLiveReference(
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<boolean> {
  const [direct] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(storageKeyMatches(clip.thumb_key, key))
    .limit(1)
  if (direct) return true

  // Legacy stable thumbnail keys remain readable for a live clip even when
  // thumb_key was not populated. This mirrors storage GC's ownership rule.
  const stableOwnerId = stableThumbnailClipId(key)
  const ownerId = clipStorageKeyClipId(key)
  if (!ownerId) return false
  const [owner] = await db
    .select({ id: clip.id, encodeRunId: clip.encode_run_id })
    .from(clip)
    .where(eq(clip.id, ownerId))
    .limit(1)
  return Boolean(
    owner &&
    (stableOwnerId ||
      activeRunBlocksStorageDeletion(owner.encodeRunId, source)),
  )
}

function activeRunReferenceCondition(source: StorageDeletionReferenceSource) {
  if (source.type !== "media-run" || !source.id) return undefined
  return sql`lower(${clip.encode_run_id}::text) <> lower(${source.id}::text)`
}

export function activeRunBlocksStorageDeletion(
  activeRunId: string | null,
  source: StorageDeletionReferenceSource,
): boolean {
  if (!activeRunId) return false
  return !(
    source.type === "media-run" &&
    source.id !== null &&
    activeRunId.toLowerCase() === source.id.toLowerCase()
  )
}

async function assetHasLiveReference(key: string): Promise<boolean> {
  const userPath = `${USER_ASSET_PATH_PREFIX}${key}`
  const gamePath = `${GAME_ASSET_PATH_PREFIX}${key}`
  const [userRows, gameRows] = await Promise.all([
    db
      .select({ id: user.id })
      .from(user)
      .where(
        or(
          exactInternalAssetPath(user.image, userPath),
          exactInternalAssetPath(user.banner, userPath),
        ),
      )
      .limit(1),
    db
      .select({ id: game.id })
      .from(game)
      .where(
        or(
          exactInternalAssetPath(game.hero_url, gamePath),
          exactInternalAssetPath(game.grid_url, gamePath),
          exactInternalAssetPath(game.logo_url, gamePath),
          exactInternalAssetPath(game.icon_url, gamePath),
        ),
      )
      .limit(1),
  ])
  return userRows.length > 0 || gameRows.length > 0
}

function exactInternalAssetPath(column: AnyColumn, expectedPath: string) {
  // Internal asset helpers append only a cache-busting query. Comparing the
  // parsed base path avoids substring/wildcard matches against external URLs.
  // Case-insensitive comparison also protects the same physical object on
  // Windows while retaining the exact legacy key for deletion on Linux.
  return sql`lower(split_part(coalesce(${column}, ''), '?', 1)) = lower(${expectedPath})`
}

function storageKeyMatches(column: AnyColumn, key: string) {
  // Historical client-supplied clip UUIDs could produce upper-case upload
  // keys. Treat case aliases as references for deletion safety on Windows,
  // but retain the exact key in the ledger so Linux can remove the object that
  // was actually minted.
  return sql`lower(${column}) = lower(${key})`
}

export function stableThumbnailClipId(key: string): string | null {
  const match =
    /^[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(thumb|thumb-small)\.jpg$/i.exec(
      key,
    )
  const clipId = match?.[1]
  if (!clipId) return null
  const role = match?.[2] === "thumb-small" ? "thumb-small" : "thumb"
  return clipAssetKey(clipId, role) === key.toLowerCase()
    ? clipId.toLowerCase()
    : null
}

/** Attribute a single-file clip object to its sharded clip directory. */
export function clipStorageKeyClipId(key: string): string | null {
  const match =
    /^[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i.exec(
      key,
    )
  const clipId = match?.[1]
  if (!clipId) return null
  const normalizedId = clipId.toLowerCase()
  const directory = key.slice(0, key.lastIndexOf("/")).toLowerCase()
  return clipAssetDir(normalizedId) === directory ? normalizedId : null
}
