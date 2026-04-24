import { and, eq, ne, sql } from "drizzle-orm"

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
