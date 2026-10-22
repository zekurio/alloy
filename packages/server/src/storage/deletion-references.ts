import {
  GAME_ASSET_PATH_PREFIX,
  USER_ASSET_PATH_PREFIX,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import {
  clip,
  clipRendition,
  game,
  type StorageDeletionNamespace,
  uploadTicket,
} from "@alloy/db/schema"
import { referencedOAuthProviderIconKeys } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { clipAssetDir } from "@alloy/server/storage/driver"
import { and, type AnyColumn, eq, isNotNull, or, sql } from "drizzle-orm"

export interface StorageDeletionReferenceSource {
  type: string
  id: string | null
}

/**
 * What keeps an object: a row that points at it, or a media run on its clip
 * that may still attach it. A reservation (`storage-prewrite`) is fulfilled
 * by a row but has to wait out a run.
 */
export type StorageDeletionReference = "row" | "run" | null

/**
 * Check DB ownership before deletion. Enqueueing and reference removal must
 * share a transaction. Writers must use versioned keys or coordinate key reuse
 * with the deletion worker; this check cannot prevent a later write.
 */
export async function storageDeletionReference(
  namespace: StorageDeletionNamespace,
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<StorageDeletionReference> {
  switch (namespace) {
    case "clips":
      return clipObjectReference(key, source)
    case "thumbnails":
      return thumbnailReference(key, source)
    case "assets":
      return (await assetHasLiveReference(key)) ? "row" : null
  }
}

async function clipObjectReference(
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<StorageDeletionReference> {
  const ownerId = clipStorageKeyClipId(key)
  const [clipRows, renditionRows, ticketRows, runRows] = await Promise.all([
    db
      .select({ id: clip.id })
      .from(clip)
      .where(
        or(
          storageKeyMatches(clip.source_key, key),
          storageKeyMatches(clip.waveform_key, key),
          storageKeyMatches(clip.cut_key, key),
        ),
      )
      .limit(1),
    db
      .select({ id: clipRendition.id })
      .from(clipRendition)
      .where(storageKeyMatches(clipRendition.storage_key, key))
      .limit(1),
    db
      .select({ id: uploadTicket.id })
      .from(uploadTicket)
      .where(storageKeyMatches(uploadTicket.storage_key, key))
      .limit(1),
    ownerId
      ? db
          .select({ id: clip.id })
          .from(clip)
          .where(
            and(
              eq(clip.id, ownerId),
              isNotNull(clip.encode_run_id),
              activeRunReferenceCondition(source),
            ),
          )
          .limit(1)
      : [],
  ])
  if (clipRows.length > 0 || renditionRows.length > 0 || ticketRows.length > 0)
    return "row"
  return runRows.length > 0 ? "run" : null
}

async function thumbnailReference(
  key: string,
  source: StorageDeletionReferenceSource,
): Promise<StorageDeletionReference> {
  const [direct] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(storageKeyMatches(clip.thumb_key, key))
    .limit(1)
  if (direct) return "row"

  const ownerId = clipStorageKeyClipId(key)
  if (!ownerId) return null
  const [owner] = await db
    .select({ id: clip.id, encodeRunId: clip.encode_run_id })
    .from(clip)
    .where(eq(clip.id, ownerId))
    .limit(1)
  return owner && activeRunBlocksStorageDeletion(owner.encodeRunId, source)
    ? "run"
    : null
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
  // OAuth provider icons live in config settings (and possibly env), not in a
  // relational column, so they are checked against the in-process config
  // state that every mutation path keeps current.
  if (referencedOAuthProviderIconKeys().has(key.toLowerCase())) return true

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
  // Windows while retaining the exact key for deletion on Linux.
  return sql`lower(split_part(coalesce(${column}, ''), '?', 1)) = lower(${expectedPath})`
}

function storageKeyMatches(column: AnyColumn, key: string) {
  // Treat case aliases as references for deletion safety on Windows,
  // but retain the exact key in the ledger so Linux can remove the object that
  // was actually minted.
  return sql`lower(${column}) = lower(${key})`
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
