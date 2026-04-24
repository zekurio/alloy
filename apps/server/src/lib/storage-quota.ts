import { and, eq, inArray, ne, sql } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

import type { db } from "../db"

type StorageUsageDb = Pick<typeof db, "select">

export async function selectSourceStorageUsedBytes(
  database: StorageUsageDb,
  userId: string
): Promise<number> {
  const [row] = await database
    .select({
      usedBytes: sql<number>`coalesce(sum(${clip.sizeBytes}), 0)::double precision`,
    })
    .from(clip)
    .where(and(eq(clip.authorId, userId), ne(clip.status, "failed")))

  return row?.usedBytes ?? 0
}

export async function selectSourceStorageUsedBytesByUserIds(
  database: StorageUsageDb,
  userIds: string[]
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()

  const rows = await database
    .select({
      userId: clip.authorId,
      usedBytes: sql<number>`coalesce(sum(${clip.sizeBytes}), 0)::double precision`,
    })
    .from(clip)
    .where(and(inArray(clip.authorId, userIds), ne(clip.status, "failed")))
    .groupBy(clip.authorId)

  return new Map(rows.map((row) => [row.userId, row.usedBytes]))
}
