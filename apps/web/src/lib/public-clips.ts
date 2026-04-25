import { clipThumbnailUrl } from "@workspace/api"

import { api } from "./api"

export interface PublicClip {
  id: string
  title: string
  game: string | null
  thumbUrl: string | null
}

const thumbnailLoadCache = new Map<string, Promise<void>>()
const publicClipThumbnailBatchCache = new WeakMap<
  PublicClip[],
  Promise<PublicClip[]>
>()

function loadThumbnail(url: string): Promise<void> {
  const cached = thumbnailLoadCache.get(url)
  if (cached) return cached

  const promise = new Promise<void>((resolve) => {
    if (typeof Image === "undefined") {
      resolve()
      return
    }

    const img = new Image()
    img.decoding = "async"

    const finish = () => resolve()

    img.onload = () => {
      if (typeof img.decode !== "function") {
        finish()
        return
      }
      img.decode().then(finish, finish)
    }
    img.onerror = finish
    img.src = url
  })

  thumbnailLoadCache.set(url, promise)
  return promise
}

export function publicClipsWithLoadedThumbnails(
  clips: PublicClip[]
): Promise<PublicClip[]> {
  const cached = publicClipThumbnailBatchCache.get(clips)
  if (cached) return cached

  const promise = Promise.all(
    clips.flatMap((clip) => (clip.thumbUrl ? [loadThumbnail(clip.thumbUrl)] : []))
  ).then(() => clips)

  publicClipThumbnailBatchCache.set(clips, promise)
  return promise
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
