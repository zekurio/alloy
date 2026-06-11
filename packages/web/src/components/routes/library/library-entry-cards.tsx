import type { ClipRow } from "@alloy/api"
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
import { Checkbox } from "@alloy/ui/components/checkbox"
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
  CloudCheckIcon,
  CloudIcon,
  DownloadIcon,
  FolderOpenIcon,
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

  return (
    <ClipCard
      title={item.title}
      titleContent={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{item.title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal ${item.title}`}
            title="Reveal in folder"
            className="size-6 shrink-0 opacity-0 transition-opacity group-hover/clip-card:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              onReveal()
            }}
          >
            <FolderOpenIcon />
          </Button>
        </span>
      }
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
      metaContent={
        <LibraryCardMeta
          source="local"
          sizeBytes={item.sizeBytes}
          createdAt={item.createdAt}
        />
      }
    />
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

const SOURCE_META: Record<
  "local" | "cloud" | "both",
  {
    icon: React.ComponentType<{ className?: string }>
    label: string
    className?: string
  }
> = {
  local: { icon: MonitorIcon, label: "On Device" },
  cloud: { icon: CloudIcon, label: "Server" },
  // A capture that lives on disk and on the server — surfaced as one synced
  // entry rather than spelling out both locations.
  both: { icon: CloudCheckIcon, label: "Synced", className: "text-success" },
}

/** Shared meta line for library cards: source · size · age. */
function LibraryCardMeta({
  source,
  sizeBytes,
  createdAt,
}: {
  source: "local" | "cloud" | "both"
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
          source={alsoLocal ? "both" : "cloud"}
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
  const [deleteLocal, setDeleteLocal] = React.useState(false)
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  // A fresh prompt shouldn't inherit the checkbox from the previous one.
  React.useEffect(() => {
    if (open) setDeleteLocal(false)
  }, [open])

  const handleConfirm = () => {
    deleteMutation.mutate(
      { clipId: row.id },
      {
        onSuccess: async () => {
          if (deleteLocal && localItem) {
            setDeletingLocal(true)
            try {
              await alloyDesktop()?.recording.deleteLibraryCapture(localItem.id)
              notifyLibraryCapturesChanged()
              toast.success("Clip deleted from server and this device")
            } catch {
              toast.error(
                "Clip deleted from server, but the local copy couldn't be removed",
              )
            } finally {
              setDeletingLocal(false)
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
          <AlertDialogDescription>
            "{row.title}" will be removed from the server. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {localItem ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={deleteLocal}
              onCheckedChange={(checked) => setDeleteLocal(checked === true)}
              disabled={pending}
            />
            <span className="text-foreground-muted">
              Also delete the local copy on this device
            </span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete clip"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function formatDraftDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
