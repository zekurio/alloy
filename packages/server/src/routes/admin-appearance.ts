import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { clipAssetVersion } from "@alloy/server/clips/asset-version"
import { db } from "@alloy/server/db/index"
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"

const LOGIN_BACKDROP_CLIP_LIMIT = 32

/**
 * Pick a fresh random set of public, ready clips that have a thumbnail. The
 * login page rotates through these as full-screen backdrops (Jellyfin-style),
 * loading each thumbnail directly from `/api/clips/:id/thumbnail` — there is no
 * server-side compositing or stored splash artifact.
 */
export async function getLoginBackdropClips(
  limit = LOGIN_BACKDROP_CLIP_LIMIT,
): Promise<Array<{ id: string; thumbVersion: string }>> {
  const rows = await db
    .select({ id: clip.id, thumbKey: clip.thumb_key })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .where(
      and(
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNotNull(clip.thumb_key),
        isNull(user.disabled_at),
      ),
    )
    .orderBy(sql`random()`)
    .limit(limit)
  return rows.flatMap((row) =>
    row.thumbKey
      ? [{ id: row.id, thumbVersion: clipAssetVersion(row.thumbKey) }]
      : [],
  )
}
