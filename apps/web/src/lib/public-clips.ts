import { clipThumbnailUrl } from "@workspace/api"

import { api } from "./api"

export interface PublicClip {
  id: string
  title: string
  game: string | null
  thumbUrl: string | null
}

export async function fetchPublicClips(): Promise<PublicClip[]> {
  try {
    const rows = await api.clips.fetch()
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
