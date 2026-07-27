import type { ClipPublishedPayload } from "@alloy/contracts"
import { selectEmbeddableClip } from "@alloy/server/clips/access"
import { embedPosterUrl, embedVideo } from "@alloy/server/clips/embed-media"
import { env } from "@alloy/server/env"
import { clipGameName } from "@alloy/server/games/ref"

export function clipPermalink(clipId: string): string {
  return new URL(`/clips/${clipId}`, env.PUBLIC_SERVER_URL).toString()
}

/**
 * Build the `clip.published` envelope, or null when the clip is no longer
 * announceable.
 *
 * Re-checked at delivery time rather than trusted from dispatch: a job may run
 * seconds after an author has taken the clip back down, and announcing it then
 * would leak a clip that is no longer public.
 */
export async function clipPublishedPayload(
  clipId: string,
  deliveryId: string,
): Promise<ClipPublishedPayload | null> {
  // selectEmbeddableClip already enforces ready status and a live author, but
  // it also admits unlisted clips because embeds are reachable by link.
  // Announcements are not: only public clips leave the instance.
  const row = await selectEmbeddableClip(clipId)
  if (!row || row.privacy !== "public") return null

  const origin = env.PUBLIC_SERVER_URL
  return {
    event: "clip.published",
    deliveryId,
    timestamp: new Date().toISOString(),
    clip: {
      id: row.id,
      url: clipPermalink(row.id),
      title: row.title,
      description: row.description,
      game: clipGameName(row),
      durationMs: row.durationMs,
      thumbnailUrl: embedPosterUrl(row, origin),
      videoUrl: embedVideo(row, origin)?.url ?? null,
      createdAt: row.createdAt.toISOString(),
    },
    author: {
      id: row.authorId,
      username: row.authorUsername,
      displayName: row.authorDisplayName,
      url: new URL(`/u/${row.authorUsername}`, origin).toString(),
    },
  }
}

/**
 * Discord cannot render playable video inside a custom embed — that field is
 * reserved for its own unfurler — so the message is the bare permalink and the
 * rich card comes from the clip page's OpenGraph tags.
 */
export function discordContent(payload: ClipPublishedPayload): string {
  return payload.clip.url
}
