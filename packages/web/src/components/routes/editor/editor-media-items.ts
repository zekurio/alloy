import { type ClipRow, clipStreamUrl, clipThumbnailUrl } from "@alloy/api"
import * as React from "react"

import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery } from "@/lib/clip-queries"
import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"

import type { EditorMediaItem } from "./editor-media-panel"
import type { EditorMediaSource } from "./editor-project"

/**
 * Media available to the editor: local captures from the library snapshot
 * merged with the user's fully processed uploaded clips (streamed from the
 * server). Yields the panel's display items and the id → source map the
 * playback/render pipelines consume.
 */
export function useEditorMedia(snapshot: RecordingLibrarySnapshot | null): {
  mediaItems: EditorMediaItem[]
  sources: Map<string, EditorMediaSource>
} {
  const localItems = React.useMemo(
    () =>
      (snapshot?.items ?? []).filter(
        (item) => item.kind !== "screenshot" && (item.durationMs ?? 0) > 0,
      ),
    [snapshot],
  )
  // Uploaded clips stream from the server as additional sources; only
  // fully processed ones have a stable source to cut from.
  const { data: session } = useSession()
  const uploadedQuery = useUserClipsQuery(session?.user?.username ?? "")
  const cloudClips = React.useMemo(
    () =>
      (uploadedQuery.data ?? []).filter(
        (row) =>
          row.status === "ready" &&
          (row.durationMs ?? 0) > 0 &&
          row.sourceContentType,
      ),
    [uploadedQuery.data],
  )

  const mediaItems = React.useMemo<EditorMediaItem[]>(
    () => [
      ...localItems.map(localMediaItem),
      ...cloudClips.map(cloudMediaItem),
    ],
    [localItems, cloudClips],
  )
  const sources = React.useMemo(() => {
    const map = new Map<string, EditorMediaSource>()
    for (const item of localItems) map.set(item.id, mediaSourceFor(item))
    for (const row of cloudClips) map.set(row.id, cloudSourceFor(row))
    return map
  }, [localItems, cloudClips])

  return { mediaItems, sources }
}

function mediaSourceFor(item: RecordingLibraryItem): EditorMediaSource {
  return {
    id: item.id,
    label: item.title,
    mediaUrl: item.mediaUrl,
    frames: item.filmstripFrameUrls,
    durationMs: item.durationMs ?? 0,
    width: item.width,
    height: item.height,
  }
}

function cloudSourceFor(row: ClipRow): EditorMediaSource {
  return {
    id: row.id,
    label: row.title,
    mediaUrl: clipStreamUrl(row.id, "source", apiOrigin()),
    frames: [],
    durationMs: row.durationMs ?? 0,
    width: row.width,
    height: row.height,
    cloud: true,
  }
}

function localMediaItem(item: RecordingLibraryItem): EditorMediaItem {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.groupLabel,
    durationMs: item.durationMs,
    thumbnailUrl: item.thumbnailUrl,
    searchText: item.fileName,
    cloud: false,
  }
}

function cloudMediaItem(row: ClipRow): EditorMediaItem {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.gameRef?.name ?? row.game ?? "Uploaded",
    durationMs: row.durationMs,
    thumbnailUrl: row.thumbKey
      ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
      : null,
    searchText: row.description ?? "",
    cloud: true,
  }
}
