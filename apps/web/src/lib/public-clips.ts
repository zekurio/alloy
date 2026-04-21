import { api } from "./api"
import { clipThumbnailUrl } from "./clips-api"

export interface PublicClip {
  id: string
  title: string
  game: string | null
  thumbUrl: string | null
}

export async function fetchPublicClips(): Promise<PublicClip[]> {
  try {
    // Empty query — takes the server's defaults (recent, 50, no cursor,
    // no window). The carousel only needs the top of the feed.
    const res = await api.api.clips.$get({ query: {} })
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{
      id: string
      title: string
      game: string | null
      thumbKey: string | null
    }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      game: r.game,
      thumbUrl: r.thumbKey ? clipThumbnailUrl(r.id) : null,
    }))
  } catch {
    return []
  }
}
