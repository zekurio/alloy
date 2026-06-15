import { type ClipRow } from "@alloy/api"
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
import { formatRelativeTime } from "@/lib/date-format"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type RecordingLibraryItem,
  type RecordingLibraryProjectDraft,
} from "@/lib/desktop"

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
  const source: LibrarySource = "local"

  return (
    <ClipCard
      title={item.title}
      titleContent={<LibraryCardTitle title={item.title} />}
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
      thumbnailOverlay={<LibraryCaptureMenu item={item} onReveal={onReveal} />}
      metaContent={
        <LibraryCardMeta
          source={source}
          sizeBytes={item.sizeBytes}
          createdAt={item.createdAt}
        />
      }
    />
  )
}

/** Three-dot actions for a local capture: reveal or delete. */
function LibraryCaptureMenu({
  item,
  onReveal,
}: {
  item: LibraryItemView
  onReveal: () => void
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

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
      titleContent={<LibraryCardTitle title={draft.title} />}
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
          source="local"
          durationMs={draft.durationMs}
          updatedAt={draft.updatedAt}
        />
      }
    />
  )
}

function LibraryDraftMeta({
  source,
  durationMs,
  updatedAt,
}: {
  source: LibrarySource
  durationMs: number
  updatedAt: string
}) {
  return (
    <>
      <LibrarySourceBadge source={source} />
      <span className="shrink-0">·</span>
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

type LibrarySource = "local" | "link-only" | "on-profile"

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
  }
> = {
  local: { icon: MonitorIcon, label: "Local" },
  "link-only": { icon: Link2Icon, label: "Link only" },
  "on-profile": { icon: GlobeIcon, label: "On profile" },
}

function LibraryCardTitle({ title }: { title: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{title}</span>
    </span>
  )
}

function LibrarySourceBadge({ source }: { source: LibrarySource }) {
  const { icon: SourceIcon, label } = SOURCE_META[source]
  return (
    <span
      className="text-foreground-muted inline-flex size-3.5 shrink-0 items-center justify-center opacity-80"
      title={label}
      aria-label={label}
    >
      <SourceIcon className="size-3" aria-hidden />
    </span>
  )
}

/** Shared meta line for library cards: size · age. */
function LibraryCardMeta({
  source,
  sizeBytes,
  createdAt,
}: {
  source: LibrarySource
  sizeBytes: number | null
  createdAt: string
}) {
  const hasSize = typeof sizeBytes === "number" && sizeBytes > 0
  return (
    <>
      <LibrarySourceBadge source={source} />
      <span className="shrink-0">·</span>
      {hasSize ? (
        <>
          <span className="shrink-0">{formatLibraryBytes(sizeBytes)}</span>
          <span className="shrink-0">·</span>
        </>
      ) : null}
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
  const source = librarySourceForPrivacy(row.privacy)
  return (
    <ClipCard
      title={card.title}
      titleContent={<LibraryCardTitle title={card.title} />}
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
      thumbnailLabel={`Edit ${card.title}`}
      onThumbnailClick={onOpen}
      thumbnailOverlay={
        <UploadedClipMenu row={row} localItem={localItem} onEdit={onOpen} />
      }
      metaContent={
        <LibraryCardMeta
          source={source}
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
                "Clip deleted from server, but the local server link couldn't be cleared",
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
