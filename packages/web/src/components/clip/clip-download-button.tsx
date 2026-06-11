import type { ClipRow } from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import * as React from "react"

import {
  clipDownloadsSupported,
  startClipDownload,
  useClipDownload,
} from "@/lib/clip-downloads"

/**
 * Shared "save this uploaded clip to the local library" affordance. Renders
 * nothing outside the desktop app (or for clips without downloadable media);
 * while a download runs, every instance reflects the same progress from the
 * shared store, and the sync tracker carries the detailed status.
 */
export function useClipDownloadAction(
  row: ClipRow,
  alreadyLocal = false,
): {
  supported: boolean
  downloading: boolean
  saved: boolean
  /** 0–100, only meaningful while downloading. */
  progress: number
  start: () => void
} {
  const download = useClipDownload(row.id)
  const supported =
    clipDownloadsSupported() &&
    row.status === "ready" &&
    Boolean(row.sourceContentType)
  const downloading = download?.status === "downloading"
  const saved = alreadyLocal || download?.status === "completed"
  const progress =
    download?.status === "downloading" && download.totalBytes
      ? Math.min(
          99,
          Math.floor((download.receivedBytes / download.totalBytes) * 100),
        )
      : 0
  const start = React.useCallback(() => {
    void startClipDownload(row).catch((cause) => {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't start the download",
      )
    })
  }, [row])
  return { supported, downloading, saved, progress, start }
}

/** Compact icon-only variant for cards and title rows. */
export function ClipDownloadIconButton({
  row,
  alreadyLocal = false,
  className,
}: {
  row: ClipRow
  /** The clip already has a copy on disk (library snapshot knowledge). */
  alreadyLocal?: boolean
  className?: string
}) {
  const action = useClipDownloadAction(row, alreadyLocal)
  if (!action.supported) return null

  const label = action.saved
    ? "Saved on this device"
    : action.downloading
      ? "Downloading…"
      : `Download ${row.title} to this device`
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={action.saved || action.downloading}
      className={cn("disabled:opacity-100", className)}
      onClick={(event) => {
        // Cards put this button inside a clickable surface.
        event.stopPropagation()
        action.start()
      }}
    >
      {action.saved ? (
        <CheckIcon className="text-success" />
      ) : action.downloading ? (
        <Loader2Icon className="animate-spin" />
      ) : (
        <DownloadIcon />
      )}
    </Button>
  )
}

/** Full-width variant for action rows (clip edit view). */
export function ClipDownloadButton({
  row,
  alreadyLocal = false,
}: {
  row: ClipRow
  alreadyLocal?: boolean
}) {
  const action = useClipDownloadAction(row, alreadyLocal)
  if (!action.supported) return null

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={action.saved || action.downloading}
      onClick={action.start}
    >
      {action.saved ? (
        <>
          <CheckIcon />
          On this device
        </>
      ) : action.downloading ? (
        <>
          <Loader2Icon className="animate-spin" />
          {action.progress > 0
            ? `Downloading ${action.progress}%`
            : "Downloading…"}
        </>
      ) : (
        <>
          <DownloadIcon />
          Save to this device
        </>
      )}
    </Button>
  )
}
