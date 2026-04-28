import type { AcceptedContentType } from "@workspace/contracts"
import { eq } from "drizzle-orm"

import { clip, type ClipEncodedVariant } from "@workspace/db/schema"

import { db } from "../db"
import { clipOriginalAssetKey, clipSourceMp4Key, storage } from "../storage"
import { probe } from "./ffmpeg"

type ClipRow = typeof clip.$inferSelect

export type SourcePromotion = {
  storageKey: string
  contentType: string
  sizeBytes: number
}

export async function promoteProcessingSource({
  clipId,
  row,
  originalSourceKey,
  contentType,
  probed,
}: {
  clipId: string
  row: ClipRow
  originalSourceKey: string
  contentType: string
  probed: Awaited<ReturnType<typeof probe>>
}): Promise<SourcePromotion> {
  const promoted = await promoteOriginalSource({
    clipId,
    row,
    originalSourceKey,
    contentType,
    probed,
  })
  if (promoted.storageKey !== originalSourceKey) {
    await storage.delete(originalSourceKey).catch(() => undefined)
  }
  return promoted
}

async function promoteOriginalSource(args: {
  clipId: string
  row: ClipRow
  originalSourceKey: string
  contentType: string
  probed: Awaited<ReturnType<typeof probe>>
}): Promise<SourcePromotion> {
  const { clipId, row, originalSourceKey, contentType, probed } = args
  if (!isStagingKey(originalSourceKey)) {
    return {
      storageKey: originalSourceKey,
      contentType,
      sizeBytes: row.sizeBytes ?? 0,
    }
  }

  const durableKey = clipOriginalAssetKey(
    clipId,
    contentType as AcceptedContentType
  )
  const { size } = await storage.copy({
    fromKey: originalSourceKey,
    toKey: durableKey,
    contentType,
  })
  await db
    .update(clip)
    .set({
      storageKey: durableKey,
      contentType,
      sizeBytes: size,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  return { storageKey: durableKey, contentType, sizeBytes: size }
}

export function makeSourceVariant({
  storageKey,
  contentType,
  width,
  height,
  sizeBytes,
  isDefault,
  trim,
}: {
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
  trim: { startMs: number | null; endMs: number | null }
}): ClipEncodedVariant {
  return {
    id: "source",
    label: "Source",
    role: "source",
    storageKey,
    contentType,
    width,
    height,
    sizeBytes,
    isDefault,
    remuxSettings: {
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
    },
  }
}

export function mergeVariantSets(
  existing: readonly ClipEncodedVariant[],
  updates: readonly ClipEncodedVariant[]
): ClipEncodedVariant[] {
  const byId = new Map<string, ClipEncodedVariant>()
  for (const variant of existing) byId.set(variant.id, variant)
  for (const variant of updates) byId.set(variant.id, variant)
  return Array.from(byId.values())
}

export function findSourceVariant(
  variants: readonly ClipEncodedVariant[]
): ClipEncodedVariant | null {
  return (
    variants.find(
      (variant) => variant.role === "source" || variant.id === "source"
    ) ?? null
  )
}

export function removeSourceVariants(
  variants: readonly ClipEncodedVariant[]
): ClipEncodedVariant[] {
  return variants.filter(
    (variant) => variant.role !== "source" && variant.id !== "source"
  )
}

export function isRemuxedSourceKey(clipId: string, key: string): boolean {
  return key === clipSourceMp4Key(clipId)
}

function isStagingKey(key: string): boolean {
  return key.includes("/staging/")
}
