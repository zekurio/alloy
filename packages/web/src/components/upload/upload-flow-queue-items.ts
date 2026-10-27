import { type QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useMemo } from "react"

import { absoluteClipHref } from "@/lib/app-paths"
import { removeClipDownload, useClipDownloads } from "@/lib/clip-downloads"
import { copyTextToClipboard } from "@/lib/clipboard"
import { alloyDesktop } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"

import {
  type ActiveUpload,
  canRetryActiveUpload,
  downloadToQueueItem,
  localToQueueItem,
  serverToQueueItem,
} from "./upload-queue-mapping"
import type { QueueItem } from "./upload-queue-types"

interface QueueItemHandlers {
  cancelRow: (localId: string | null, clipId: string | null) => void
  retryUpload: (localId: string) => void
  reEncodeClip: (input: { clipId: string }) => void
  onOpenClip: (row: QueueClip) => void
  dismiss: (clipId: string) => void
  releaseRetainedThumb: (clipId: string) => void
}

export function useUploadQueueItems(
  active: ReadonlyMap<string, ActiveUpload>,
  retainedThumbs: ReadonlyMap<string, string>,
  serverQueue: QueueClip[],
  handlers: QueueItemHandlers,
): QueueItem[] {
  const downloads = useClipDownloads()
  const localItems = useLocalQueueItems(active, handlers)
  const serverItems = useServerQueueItems(
    serverQueue,
    active,
    retainedThumbs,
    handlers,
  )
  const downloadItems = useDownloadQueueItems(downloads)
  return useMemo(
    () => [...downloadItems, ...localItems, ...serverItems],
    [downloadItems, localItems, serverItems],
  )
}

function useLocalQueueItems(
  active: ReadonlyMap<string, ActiveUpload>,
  handlers: QueueItemHandlers,
) {
  return useMemo(
    () =>
      Array.from(active.values()).map((entry) =>
        localToQueueItem(entry, {
          onCancel: () =>
            handlers.cancelRow(entry.localId, entry.clipId ?? null),
          onRetry: canRetryActiveUpload(entry)
            ? () => handlers.retryUpload(entry.localId)
            : undefined,
        }),
      ),
    [active, handlers.cancelRow, handlers.retryUpload],
  )
}

function useServerQueueItems(
  serverQueue: QueueClip[],
  active: ReadonlyMap<string, ActiveUpload>,
  retainedThumbs: ReadonlyMap<string, string>,
  handlers: QueueItemHandlers,
) {
  return useMemo(() => {
    const localClipIds = new Set(
      Array.from(active.values())
        .map((entry) => entry.clipId)
        .filter((clipId): clipId is string => Boolean(clipId)),
    )
    return serverQueue
      .filter((row) => !localClipIds.has(row.id))
      .map((row) =>
        serverToQueueItem(row, {
          onCancel:
            row.status === "pending" || row.status === "processing"
              ? () => handlers.cancelRow(null, row.id)
              : undefined,
          onOpen:
            row.status === "ready" || row.status === "failed"
              ? () => handlers.onOpenClip(row)
              : undefined,
          onCopyLink:
            row.status === "ready" ? () => copyClipLink(row) : undefined,
          onRetry:
            !row.encodeActive &&
            (row.status === "failed" ||
              (row.status === "ready" && row.failureReason))
              ? () => handlers.reEncodeClip({ clipId: row.id })
              : undefined,
          onDismiss:
            !row.encodeActive &&
            (row.status === "ready" || row.status === "failed")
              ? () => {
                  handlers.releaseRetainedThumb(row.id)
                  handlers.dismiss(row.id)
                }
              : undefined,
          thumbFallbackUrl: retainedThumbs.get(row.id),
          onThumbLoad: () => handlers.releaseRetainedThumb(row.id),
        }),
      )
  }, [
    serverQueue,
    active,
    retainedThumbs,
    handlers.cancelRow,
    handlers.onOpenClip,
    handlers.reEncodeClip,
    handlers.releaseRetainedThumb,
    handlers.dismiss,
  ])
}

function useDownloadQueueItems(downloads: ReturnType<typeof useClipDownloads>) {
  return useMemo(
    () =>
      downloads.map((download) => {
        const libraryItemId = download.libraryItemId
        return downloadToQueueItem(download, {
          onCancel: () => removeClipDownload(download.clipId),
          onOpen: libraryItemId
            ? () => {
                void alloyDesktop()?.recording.revealLibraryCapture(
                  libraryItemId,
                )
              }
            : undefined,
          onDismiss:
            download.status !== "downloading"
              ? () => removeClipDownload(download.clipId)
              : undefined,
        })
      }),
    [downloads],
  )
}

async function copyClipLink(row: QueueClip): Promise<void> {
  const copied = await copyTextToClipboard(
    absoluteClipHref(row.gameSlug ?? null, row.id, publicOrigin()),
    { action: "copy uploaded clip link" },
  )
  if (!copied) throw new Error(t("Couldn't copy link"))
}
