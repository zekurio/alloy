import { clip } from "@alloy/db/schema"
import type { db } from "@alloy/server/db/index"
import { and, eq, inArray, ne, sql } from "drizzle-orm"

type StorageUsageDb = Pick<typeof db, "select">

export async function selectSourceStorageUsedBytes(
  database: StorageUsageDb,
  userId: string,
): Promise<number> {
  const [clipRow] = await database
    .select({
      usedBytes: sql<number>`coalesce(sum(${clip.sourceSizeBytes}), 0)::double precision`,
    })
    .from(clip)
    .where(and(eq(clip.authorId, userId), ne(clip.status, "failed")))

  return clipRow?.usedBytes ?? 0
}

export async function selectSourceStorageUsedBytesByUserIds(
  database: StorageUsageDb,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()

  const usage = new Map<string, number>()

  const clipRows = await database
    .select({
      userId: clip.authorId,
      usedBytes: sql<number>`coalesce(sum(${clip.sourceSizeBytes}), 0)::double precision`,
    })
    .from(clip)
    .where(and(inArray(clip.authorId, userIds), ne(clip.status, "failed")))
    .groupBy(clip.authorId)
  for (const row of clipRows) {
    usage.set(row.userId, (usage.get(row.userId) ?? 0) + row.usedBytes)
  }

  return usage
}
