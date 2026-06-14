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

  // A downloaded (or originally recorded) local copy supersedes its cloud
  // clip: the panel hides the duplicate cloud row, and the sources map also
  // resolves the clip id to the file on disk so existing projects that
  // referenced the streamed source start reading locally.
  const localClipIds = React.useMemo(
    () =>
      new Set(
        localItems
          .map((item) => item.uploadedClipId ?? item.syncedRecordingId)
          .filter((id): id is string => Boolean(id)),
      ),
    [localItems],
  )

  const mediaItems = React.useMemo<EditorMediaItem[]>(
    () => [
      ...localItems.map(localMediaItem),
      ...cloudClips
        .filter((row) => !localClipIds.has(row.id))
        .map(cloudMediaItem),
    ],
    [localItems, cloudClips, localClipIds],
  )
  const sources = React.useMemo(() => {
    const map = new Map<string, EditorMediaSource>()
    for (const row of cloudClips) map.set(row.id, cloudSourceFor(row))
    for (const item of localItems) {
      const source = mediaSourceFor(item)
      map.set(item.id, source)
      if (item.uploadedClipId) map.set(item.uploadedClipId, source)
      if (item.syncedRecordingId) map.set(item.syncedRecordingId, source)
    }
    return map
  }, [localItems, cloudClips])

  return { mediaItems, sources }
}

function mediaSourceFor(item: RecordingLibraryItem): EditorMediaSource {
  return {
    id: item.id,
    label: item.title,
    mediaUrl: item.mediaUrl,
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
    clipRow: row,
  }
}
