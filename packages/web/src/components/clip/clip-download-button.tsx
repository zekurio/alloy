import { clipDownloadUrl, type ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { DropdownMenuItem } from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { useCallback } from "react"

import { startBrowserDownload } from "@/lib/browser-download"
import {
  clipDownloadsSupported,
  startClipDownload,
  useClipDownload,
} from "@/lib/clip-downloads"
import { apiOrigin } from "@/lib/env"

/**
 * Shared "save this uploaded clip to the local library" affordance. Renders
 * nothing outside the desktop app (or for clips without downloadable media);
 * while a download runs, every instance reflects the same progress from the
 * shared store, and the sync tracker carries the detailed status.
 */
/**
 * Non-hook variant of the support check, for call sites that decide whether
 * to render a download action at all (e.g. menu gating).
 */
export function clipDownloadActionSupported(row: ClipRow): boolean {
  return (
    clipDownloadsSupported() &&
    row.status === "ready" &&
    Boolean(row.playbackContentType)
  )
}

export function clipBrowserDownloadActionSupported(row: ClipRow): boolean {
  return row.status === "ready" && Boolean(row.playbackContentType)
}

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
  const supported = clipDownloadActionSupported(row)
  const downloading = download?.status === "downloading"
  const saved = alreadyLocal || download?.status === "completed"
  const progress =
    download?.status === "downloading" && download.totalBytes
      ? Math.min(
          99,
          Math.floor((download.receivedBytes / download.totalBytes) * 100),
        )
      : 0
  const start = useCallback(() => {
    void startClipDownload(row).catch((cause) => {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t("Couldn't start the download"),
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
    ? t("Saved on this device")
    : action.downloading
      ? t("Downloading…")
      : t("Download {title} to this device", { title: row.title })
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
      <ClipDownloadStatusIcon action={action} />
    </Button>
  )
}

/** Dropdown menu item variant for clip action menus. */
export function ClipDownloadMenuItem({
  row,
  alreadyLocal = false,
}: {
  row: ClipRow
  alreadyLocal?: boolean
}) {
  const action = useClipDownloadAction(row, alreadyLocal)
  if (!action.supported) return null

  return (
    <DropdownMenuItem
      disabled={action.saved || action.downloading}
      onClick={(event) => {
        event.stopPropagation()
        action.start()
      }}
    >
      <ClipDownloadStatusIcon action={action} />
      {clipDownloadMenuLabel(action)}
    </DropdownMenuItem>
  )
}

/** Browser download variant for clip action menus. */
export function ClipBrowserDownloadMenuItem({ row }: { row: ClipRow }) {
  if (!clipBrowserDownloadActionSupported(row)) return null

  return (
    <DropdownMenuItem
      onClick={(event) => {
        event.stopPropagation()
        const started = startBrowserDownload(
          clipDownloadUrl(row.id, apiOrigin()),
        )
        if (!started) toast.error(t("Couldn't start download"))
      }}
    >
      <DownloadIcon />
      {t("Download")}
    </DropdownMenuItem>
  )
}

type ClipDownloadAction = ReturnType<typeof useClipDownloadAction>

function ClipDownloadStatusIcon({ action }: { action: ClipDownloadAction }) {
  if (action.saved) return <CheckIcon className="text-success" />
  if (action.downloading) return <Loader2Icon className="animate-spin" />
  return <DownloadIcon />
}

function clipDownloadMenuLabel(action: ClipDownloadAction): string {
  if (action.saved) return t("Saved on this device")
  if (!action.downloading) return t("Download")
  return action.progress > 0
    ? t("Downloading {progress}%", { progress: action.progress })
    : t("Downloading…")
}
