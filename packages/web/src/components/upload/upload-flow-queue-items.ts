import { type QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useMemo } from "react"
import type { MutableRefObject } from "react"

import { absoluteClipHref } from "@/lib/app-paths"
import { removeClipDownload, useClipDownloads } from "@/lib/clip-downloads"
import { copyTextToClipboard } from "@/lib/clipboard"
import { alloyDesktop } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"

import {
  type ActiveUpload,
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
  queueVersion: number,
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  serverQueue: QueueClip[],
  dismissed: Set<string>,
  handlers: QueueItemHandlers,
): QueueItem[] {
  const downloads = useClipDownloads()
  const localItems = useLocalQueueItems(queueVersion, activeRef, handlers)
  const serverItems = useServerQueueItems(
    queueVersion,
    serverQueue,
    activeRef,
    retainedThumbsRef,
    dismissed,
    handlers,
  )
  const downloadItems = useDownloadQueueItems(downloads)
  return useMemo(
    () => [...downloadItems, ...localItems, ...serverItems],
    [downloadItems, localItems, serverItems],
  )
}

function useLocalQueueItems(
  queueVersion: number,
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  handlers: QueueItemHandlers,
) {
  return useMemo(
    () =>
      Array.from(activeRef.current.values()).map((entry) =>
        localToQueueItem(entry, {
          onCancel: () =>
            handlers.cancelRow(entry.localId, entry.clipId ?? null),
          onRetry:
            entry.status === "error"
              ? () => handlers.retryUpload(entry.localId)
              : undefined,
        }),
      ),
    [queueVersion, activeRef, handlers.cancelRow, handlers.retryUpload],
  )
}

function useServerQueueItems(
  queueVersion: number,
  serverQueue: QueueClip[],
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  dismissed: Set<string>,
  handlers: QueueItemHandlers,
) {
  return useMemo(() => {
    const localClipIds = new Set(
      Array.from(activeRef.current.values())
        .map((entry) => entry.clipId)
        .filter((clipId): clipId is string => Boolean(clipId)),
    )
    return serverQueue
      .filter((row) => !localClipIds.has(row.id) && !dismissed.has(row.id))
      .map((row) =>
        serverToQueueItem(row, {
          onCancel: () => handlers.cancelRow(null, row.id),
          onOpen:
            row.status === "ready" ? () => handlers.onOpenClip(row) : undefined,
          onCopyLink:
            row.status === "ready" ? () => copyClipLink(row) : undefined,
          onRetry:
            row.status === "failed"
              ? () => handlers.reEncodeClip({ clipId: row.id })
              : undefined,
          onDismiss:
            row.status === "ready"
              ? () => {
                  handlers.releaseRetainedThumb(row.id)
                  handlers.dismiss(row.id)
                }
              : undefined,
          thumbFallbackUrl: retainedThumbsRef.current.get(row.id),
          onThumbLoad: () => handlers.releaseRetainedThumb(row.id),
        }),
      )
  }, [
    queueVersion,
    serverQueue,
    activeRef,
    retainedThumbsRef,
    dismissed,
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
      downloads.map((download) =>
        downloadToQueueItem(download, {
          onCancel: () => removeClipDownload(download.clipId),
          onOpen: download.libraryItemId
            ? () => {
                void alloyDesktop()?.recording.revealLibraryCapture(
                  download.libraryItemId as string,
                )
              }
            : undefined,
          onDismiss:
            download.status !== "downloading"
              ? () => removeClipDownload(download.clipId)
              : undefined,
        }),
      ),
    [downloads],
  )
}

async function copyClipLink(row: QueueClip): Promise<void> {
  const copied = await copyTextToClipboard(
    absoluteClipHref(row.gameSlug ?? null, row.id, publicOrigin()),
    { action: "copy uploaded clip link" },
  )
  if (copied) {
    toast.success(t("Link copied"))
    return
  }
  toast.error(t("Couldn't copy link"))
}
