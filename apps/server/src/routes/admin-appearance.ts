import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { isoDate } from "../runtime/date"

const LOGIN_SPLASH_CLIP_LIMIT = 24

async function selectRandomPublicSplashClipIds(): Promise<string[]> {
  const rows = await db
    .select({ id: clip.id })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(
      and(
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNotNull(clip.thumbKey),
        isNull(user.disabledAt)
      )
    )
    .orderBy(sql`random()`)
    .limit(LOGIN_SPLASH_CLIP_LIMIT)
  return rows.map((row) => row.id)
}

export async function generateLoginSplashPatch(enabled = true) {
  return {
    enabled,
    clipIds: await selectRandomPublicSplashClipIds(),
    generatedAt: isoDate(new Date()),
  }
}
