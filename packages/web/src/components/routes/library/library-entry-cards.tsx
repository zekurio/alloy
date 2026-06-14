import {
  type ClipRow,
  type StagingRecordingRow,
  stagingStreamUrl,
  stagingThumbnailUrl,
} from "@alloy/api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { ClipCard } from "@alloy/ui/components/clip-card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudUploadIcon,
  DownloadIcon,
  FolderOpenIcon,
  GlobeIcon,
  Link2Icon,
  MonitorIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { useClipDownloadAction } from "@/components/clip/clip-download-button"
import { useCapturePoster } from "@/lib/capture-poster"
import { toClipCardData } from "@/lib/clip-format"
import { useDeleteClipMutation } from "@/lib/clip-queries"
import {
  clipSyncSupported,
  queueClipSyncItem,
  useClipSync,
} from "@/lib/clip-sync"
import { formatRelativeTime } from "@/lib/date-format"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type RecordingLibraryItem,
  type RecordingLibraryProjectDraft,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { useDeleteStagingMutation } from "@/lib/staging-queries"

import { formatLibraryBytes, type LibraryItemView } from "./library-data"
import { DeleteServerBackedDialog } from "./library-delete-dialog"
import {
  deleteLocalLibraryCopy,
  detachLocalServerLink,
} from "./library-local-actions"

export function LibraryCaptureCard({
  item,
  onOpen,
  onReveal,
}: {
  item: LibraryItemView
  onOpen: () => void
  onReveal: () => void
}) {
  const thumbnail = useCapturePoster({
    id: item.id,
    mediaUrl: item.kind === "screenshot" ? null : item.mediaUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationMs: item.durationMs,
    enabled: item.kind !== "screenshot",
  })
  const { source, progressPct } = useCaptureSyncSource(item)

  return (
    <ClipCard
      title={item.title}
      author=""
      game={item.displayGameName}
      gameIcon={item.displayGameIconUrl}
      gameHref={item.gameSlug ? `/g/${item.gameSlug}` : null}
      views="0"
      likes="0"
      thumbnail={thumbnail ?? undefined}
      thumbnailBlurHash={item.thumbBlurHash}
      fallbackSeed={`${item.groupLabel}:${item.id}`}
      streamUrl={item.kind === "screenshot" ? undefined : item.mediaUrl}
      thumbnailLabel={`Edit ${item.title}`}
      onThumbnailClick={onOpen}
      thumbnailOverlay={
        <LibraryCaptureMenu item={item} source={source} onReveal={onReveal} />
      }
      metaContent={
        <LibraryCardMeta
          source={source}
          progressPct={progressPct}
          sizeBytes={item.sizeBytes}
          createdAt={item.createdAt}
        />
      }
    />
  )
}

/** Three-dot actions for a local capture: sync, reveal, delete. */
function LibraryCaptureMenu({
  item,
  source,
  onReveal,
}: {
  item: LibraryItemView
  source: LibrarySource
  onReveal: () => void
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const canSync =
    source === "local" && item.kind !== "screenshot" && clipSyncSupported()

  const sync = async () => {
    setBusy(true)
    try {
      await queueClipSyncItem(item.id)
      toast.success("Syncing to your library")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't sync")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await alloyDesktop()?.recording.deleteLibraryCapture(item.id)
      toast.success("Moved to trash")
      notifyLibraryCapturesChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't delete")
    } finally {
      setBusy(false)
      setDeleteDialogOpen(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${item.title}`}
              className={cn(
                "bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 hover:text-white",
                "opacity-0 transition-opacity group-hover/clip-card:opacity-100",
                "focus-visible:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <MoreVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {canSync ? (
            <DropdownMenuItem onClick={sync} disabled={busy}>
              <CloudUploadIcon className="size-4" />
              Sync to server
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onReveal}>
            <FolderOpenIcon className="size-4" />
            Reveal in folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2Icon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be moved to your system trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={remove}
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Sync badge for a local capture card. The snapshot's syncState covers the
 * resting states; the live sync queue overrides it between library re-scans
 * and supplies the in-flight percentage.
 */
function useCaptureSyncSource(item: LibraryItemView): {
  source: LibrarySource
  progressPct: number | null
} {
  const sync = useClipSync()
  const live = sync.items.find((entry) => entry.captureId === item.id)
  if (live) {
    switch (live.status) {
      case "queued":
        return { source: "queued", progressPct: null }
      case "failed":
        return { source: "sync-failed", progressPct: null }
      case "completed":
        return { source: "synced", progressPct: null }
      default:
        return {
          source: "syncing",
          progressPct:
            live.status === "uploading" && live.totalBytes > 0
              ? Math.min(
                  99,
                  Math.floor((live.bytesSent / live.totalBytes) * 100),
                )
              : null,
        }
    }
  }
  switch (item.syncState) {
    case "queued":
      return { source: "queued", progressPct: null }
    case "syncing":
      return { source: "syncing", progressPct: null }
    case "failed":
      return { source: "sync-failed", progressPct: null }
    case "synced":
      return { source: "synced", progressPct: null }
    default:
      return { source: "local", progressPct: null }
  }
}

/** Grid card for an unfinished multitrack project saved from the editor. */
export function ProjectDraftCard({
  draft,
  thumbnailUrl,
  thumbBlurHash,
  onOpen,
}: {
  draft: RecordingLibraryProjectDraft
  thumbnailUrl: string | null
  thumbBlurHash: string | null
  onOpen: () => void
}) {
  return (
    <ClipCard
      title={draft.title}
      author=""
      game=""
      gameIcon={null}
      gameHref={null}
      views="0"
      likes="0"
      thumbnail={thumbnailUrl ?? undefined}
      thumbnailBlurHash={thumbBlurHash}
      fallbackSeed={`draft:${draft.id}`}
      thumbnailLabel={`Open draft ${draft.title}`}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryDraftMeta
          durationMs={draft.durationMs}
          updatedAt={draft.updatedAt}
        />
      }
    />
  )
}

function LibraryDraftMeta({
  durationMs,
  updatedAt,
}: {
  durationMs: number
  updatedAt: string
}) {
  return (
    <>
      <span className="text-foreground-muted shrink-0">Draft</span>
      {durationMs > 0 ? (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatDraftDuration(durationMs)}</span>
        </>
      ) : null}
      <span className="shrink-0">·</span>
      <span className="truncate">{formatRelativeTime(updatedAt)}</span>
    </>
  )
}

/** Grid card for an owner-only staging recording (a synced draft). */
export function StagingClipCard({
  row,
  localItem = null,
  onOpen,
}: {
  row: StagingRecordingRow
  localItem?: RecordingLibraryItem | null
  onOpen: () => void
}) {
  const processing = row.status !== "ready" || row.encodeProgress < 100
  const thumbnail = row.thumbKey
    ? stagingThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : undefined
  return (
    <ClipCard
      title={row.title}
      author=""
      game={row.gameRef?.name ?? row.game ?? ""}
      gameIcon={row.gameRef?.iconUrl ?? null}
      gameHref={row.gameRef?.slug ? `/g/${row.gameRef.slug}` : null}
      views="0"
      likes="0"
      thumbnail={thumbnail}
      thumbnailBlurHash={row.thumbBlurHash}
      fallbackSeed={`staging:${row.id}`}
      streamUrl={
        processing ? undefined : stagingStreamUrl(row.id, "source", apiOrigin())
      }
      thumbnailLabel={`Edit ${row.title}`}
      onThumbnailClick={onOpen}
      thumbnailOverlay={
        <StagingClipMenu row={row} localItem={localItem} onEdit={onOpen} />
      }
      metaContent={
        <LibraryStagingMeta
          kind={row.kind}
          sizeBytes={row.sourceSizeBytes}
          createdAt={row.createdAt}
          processing={processing}
          progress={row.encodeProgress}
        />
      }
    />
  )
}

/** Three-dot actions for a staging recording: edit or delete the draft. */
function StagingClipMenu({
  row,
  localItem,
  onEdit,
}: {
  row: StagingRecordingRow
  localItem: RecordingLibraryItem | null
  onEdit: () => void
}) {
  const deleteMutation = useDeleteStagingMutation()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const handleConfirm = (deleteLocal: boolean) => {
    deleteMutation.mutate(
      { id: row.id },
      {
        onSuccess: async () => {
          if (!localItem) {
            toast.success("Recording deleted")
            setDeleteDialogOpen(false)
            return
          }
          if (deleteLocal) {
            setDeletingLocal(true)
            try {
              await deleteLocalLibraryCopy(localItem)
              toast.success("Recording deleted from server and this device")
            } catch {
              await detachLocalServerLink({
                item: localItem,
                serverId: row.id,
              }).catch(() => undefined)
              toast.error(
                "Recording deleted from server, but the local copy couldn't be removed",
              )
            } finally {
              setDeletingLocal(false)
            }
          } else {
            try {
              await detachLocalServerLink({
                item: localItem,
                serverId: row.id,
              })
              toast.success("Recording deleted from server")
            } catch {
              toast.error(
                "Recording deleted from server, but the local sync link couldn't be cleared",
              )
            }
          }
          setDeleteDialogOpen(false)
        },
        onError: () => toast.error("Couldn't delete recording"),
      },
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${row.title}`}
              className={cn(
                "bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 hover:text-white",
                "opacity-0 transition-opacity group-hover/clip-card:opacity-100",
                "focus-visible:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <MoreVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2Icon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteServerBackedDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        pending={pending}
        title={row.title}
        noun="recording"
        localItem={localItem}
        onConfirm={handleConfirm}
      />
    </>
  )
}

function LibraryStagingMeta({
  kind,
  sizeBytes,
  createdAt,
  processing,
  progress,
}: {
  kind: "clip" | "session"
  sizeBytes: number | null
  createdAt: string
  processing: boolean
  progress: number
}) {
  const hasSize = typeof sizeBytes === "number" && sizeBytes > 0
  const clamped = Math.max(0, Math.min(100, progress))
  return (
    <>
      <span className="text-foreground-muted flex shrink-0 items-center gap-1">
        <CloudCheckIcon className="size-3.5" />
        {processing ? `Processing ${clamped}%` : "Synced"}
      </span>
      <span className="shrink-0">·</span>
      <span className="shrink-0">
        {kind === "session" ? "Session" : "Clip"}
      </span>
      {hasSize ? (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatLibraryBytes(sizeBytes)}</span>
        </>
      ) : null}
      <span className="shrink-0">·</span>
      <span className="truncate">{formatRelativeTime(createdAt)}</span>
    </>
  )
}

type LibrarySource =
  | "local"
  | "synced"
  | "link-only"
  | "on-profile"
  | "queued"
  | "syncing"
  | "sync-failed"

/** How visible a published clip is, mirroring the privacy picker icons. */
export function librarySourceForPrivacy(
  privacy: "public" | "unlisted",
): LibrarySource {
  return privacy === "public" ? "on-profile" : "link-only"
}

const SOURCE_META: Record<
  LibrarySource,
  {
    icon: React.ComponentType<{ className?: string }>
    label: string
    className?: string
  }
> = {
  local: { icon: MonitorIcon, label: "On Device" },
  // Server-backed clips badge by visibility, not location: a private clip is
  // just a backup, an unlisted one is shared via its link, a public one is
  // live on the profile/feeds.
  synced: { icon: CloudCheckIcon, label: "Synced" },
  "link-only": { icon: Link2Icon, label: "Link only" },
  "on-profile": { icon: GlobeIcon, label: "On profile" },
  // Positions in the desktop sync queue.
  queued: { icon: CloudUploadIcon, label: "Queued" },
  syncing: {
    icon: CloudUploadIcon,
    label: "Syncing",
    className: "text-accent",
  },
  "sync-failed": {
    icon: CloudAlertIcon,
    label: "Sync failed",
    className: "text-destructive",
  },
}

/** Shared meta line for library cards: source · size · age. */
function LibraryCardMeta({
  source,
  progressPct = null,
  originDeviceName = null,
  sizeBytes,
  createdAt,
}: {
  source: LibrarySource
  /** In-flight sync percentage shown next to the "Syncing" label. */
  progressPct?: number | null
  /** Device that uploaded the clip, shown on cloud rows ("From X"). */
  originDeviceName?: string | null
  sizeBytes: number | null
  createdAt: string
}) {
  const { icon: SourceIcon, label, className } = SOURCE_META[source]
  const hasSize = typeof sizeBytes === "number" && sizeBytes > 0
  return (
    <>
      <span className={cn("flex shrink-0 items-center gap-1", className)}>
        <SourceIcon className="size-3.5" />
        {label}
        {progressPct !== null ? (
          <span className="tabular-nums">{progressPct}%</span>
        ) : null}
      </span>
      {originDeviceName ? (
        <>
          <span className="shrink-0">·</span>
          <span className="truncate">From {originDeviceName}</span>
        </>
      ) : null}
      {hasSize ? (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatLibraryBytes(sizeBytes)}</span>
        </>
      ) : null}
      <span className="shrink-0">·</span>
      <span className="truncate">{formatRelativeTime(createdAt)}</span>
    </>
  )
}

/** Grid card for a clip that already lives on the server. */
export function UploadedClipCard({
  row,
  localItem = null,
  onOpen,
}: {
  row: ClipRow
  /** The on-disk capture backing this clip (uploaded from / downloaded). */
  localItem?: RecordingLibraryItem | null
  onOpen: () => void
}) {
  const card = React.useMemo(() => toClipCardData(row), [row])
  const alsoLocal = localItem !== null
  return (
    <ClipCard
      title={card.title}
      author=""
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={card.gameSlug ? `/g/${card.gameSlug}` : null}
      views={card.views}
      likes={card.likes}
      thumbnail={card.thumbnail}
      thumbnailBlurHash={card.thumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      streamUrl={card.streamUrl}
      privacy={card.privacy}
      thumbnailLabel={`Edit ${card.title}`}
      onThumbnailClick={onOpen}
      thumbnailOverlay={
        <UploadedClipMenu row={row} localItem={localItem} onEdit={onOpen} />
      }
      metaContent={
        <LibraryCardMeta
          source={librarySourceForPrivacy(row.privacy)}
          originDeviceName={alsoLocal ? null : row.originDeviceName}
          sizeBytes={row.sourceSizeBytes}
          createdAt={row.createdAt}
        />
      }
    />
  )
}

/**
 * Three-dot actions menu floating over an uploaded clip's thumbnail:
 * download to this device (desktop only), open the edit view, and delete —
 * optionally including the local copy when one exists on disk.
 */
function UploadedClipMenu({
  row,
  localItem,
  onEdit,
}: {
  row: ClipRow
  localItem: RecordingLibraryItem | null
  onEdit: () => void
}) {
  const download = useClipDownloadAction(row, localItem !== null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${row.title}`}
              className={cn(
                "bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 hover:text-white",
                "opacity-0 transition-opacity group-hover/clip-card:opacity-100",
                "focus-visible:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <MoreVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {download.supported ? (
            <DropdownMenuItem
              disabled={download.saved || download.downloading}
              onClick={download.start}
            >
              <DownloadIcon />
              {download.saved
                ? "On this device"
                : download.downloading
                  ? "Downloading…"
                  : "Download"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteUploadedClipDialog
        row={row}
        localItem={localItem}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </>
  )
}

function DeleteUploadedClipDialog({
  row,
  localItem,
  open,
  onOpenChange,
}: {
  row: ClipRow
  localItem: RecordingLibraryItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deleteMutation = useDeleteClipMutation()
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const handleConfirm = (deleteLocal: boolean) => {
    deleteMutation.mutate(
      { clipId: row.id },
      {
        onSuccess: async () => {
          if (deleteLocal && localItem) {
            setDeletingLocal(true)
            try {
              await deleteLocalLibraryCopy(localItem)
              toast.success("Clip deleted from server and this device")
            } catch {
              await detachLocalServerLink({
                item: localItem,
                serverId: row.id,
              }).catch(() => undefined)
              toast.error(
                "Clip deleted from server, but the local copy couldn't be removed",
              )
            } finally {
              setDeletingLocal(false)
            }
          } else if (localItem) {
            try {
              await detachLocalServerLink({
                item: localItem,
                serverId: row.id,
              })
              toast.success("Clip deleted from server")
            } catch {
              toast.error(
                "Clip deleted from server, but the local sync link couldn't be cleared",
              )
            }
          } else {
            toast.success("Clip deleted")
          }
          onOpenChange(false)
        },
        onError: () => toast.error("Couldn't delete clip"),
      },
    )
  }

  return (
    <DeleteServerBackedDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={row.title}
      noun="clip"
      localItem={localItem}
      onConfirm={handleConfirm}
    />
  )
}

function formatDraftDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
