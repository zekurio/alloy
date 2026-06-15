import { type ClipRow, clipStreamUrl, clipThumbnailUrl } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Progress } from "@alloy/ui/components/progress"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import { CloudIcon } from "lucide-react"
import * as React from "react"

import { VideoPlayer } from "@/components/video/video-player"
import { useSession } from "@/lib/auth-client"
import { clientLogger } from "@/lib/client-log"
import {
  useClipQuery,
  useDeleteClipMutation,
  useTrimClipMutation,
} from "@/lib/clip-queries"
import { apiOrigin } from "@/lib/env"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import { ClipEditorTabs } from "./library-clip-editor-details"
import { DeleteServerBackedDialog } from "./library-delete-dialog"
import {
  BackToLibraryButton,
  TrimTransportControls,
} from "./library-editor-shared"
import {
  LibraryEntryNavButton,
  type NavigableLibraryEntry,
  useLibraryEditorShortcuts,
  useLibraryEntryNavigation,
  useNavigateToLibraryEntry,
} from "./library-entry-navigation"
import {
  deleteLocalLibraryCopy,
  detachLocalServerLink,
} from "./library-local-actions"
import { LibraryMediaStage, mediaAspectRatio } from "./library-media-stage"
import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

/**
 * Edit view for an already-uploaded clip: the same stage-and-trimmer layout
 * as the local capture editor on the left, and a Details / Comments tabbed
 * sheet on the right. Saving the trim cuts the clip's media on the server
 * and reprocesses it in place — id, comments, and likes survive.
 */
export function LibraryClipEditorPage({ clipId }: { clipId: string }) {
  const query = useClipQuery(clipId)
  const row = query.data

  if (!row) {
    return (
      <AppMain>
        {query.isError ? (
          <LibraryEmpty
            icon={<CloudIcon />}
            title="Clip not found"
            description="It may have been deleted, or you may not have access to it."
          >
            <BackToLibraryButton />
          </LibraryEmpty>
        ) : (
          <LoadingState className="py-16" />
        )}
      </AppMain>
    )
  }

  return (
    <AppMain className="p-4 md:p-6">
      {/* Keyed by clip id: edits reset when navigating between clips, but
          survive background detail refetches. */}
      <ClipEditorBody key={row.id} row={row} />
    </AppMain>
  )
}

function ClipEditorBody({ row }: { row: ClipRow }) {
  const navigation = useLibraryEntryNavigation({ type: "cloud", id: row.id })
  const { localItem, prevEntry, nextEntry } = navigation
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const canManage =
    viewerId !== null && (viewerId === row.authorId || viewerRole === "admin")
  const isOwner = viewerId !== null && viewerId === row.authorId

  const processing = row.status !== "ready" || row.encodeProgress < 100
  const canTrim = isOwner && !processing

  const playback = useTrimPlayback({
    initialDurationMs: row.durationMs ?? 0,
    canTrim,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback

  const trimMutation = useTrimClipMutation()
  const deleteFlow = useServerBackedClipDelete({
    row,
    localItem,
    prevEntry,
    nextEntry,
  })
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending

  // Keep metadata-only updates (post/unpost, title, tags) from making the
  // player and poster reload. Server trims still change this through the
  // media-shaped fields and status transitions.
  const mediaVersion = clipEditorMediaVersion(row)
  const streamSrc = `${clipStreamUrl(row.id, "source", apiOrigin())}&v=${encodeURIComponent(mediaVersion)}`
  const filmstrip = useMediaFilmstrip(processing ? null : streamSrc)
  const poster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), mediaVersion)
    : undefined
  const aspectRatio = mediaAspectRatio(row.width, row.height)

  useLibraryEditorShortcuts({
    prevEntry,
    nextEntry,
    onDelete: () => {
      if (canManage) deleteFlow.openDialog()
    },
    togglePlayback: playback.togglePlayback,
  })

  const handleSaveTrim = () => {
    if (!canSaveTrim) return
    playerRef.current?.pause()
    trimMutation.mutate(
      {
        clipId: row.id,
        startMs: Math.round(trim.startMs),
        endMs: Math.round(trim.endMs),
      },
      {
        onSuccess: () => {
          toast.success("Trim saved — the clip is reprocessing")
          playback.setTrim({ startMs: 0, endMs: 0 })
          playback.setCurrentMs(0)
        },
        onError: (cause) =>
          toast.error(cause.message || "Couldn't trim the clip"),
      },
    )
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        {/* ── Stage: player, transport, and the trimmer. ── */}
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <LibraryMediaStage aspectRatio={aspectRatio}>
            <VideoPlayer
              src={streamSrc}
              sourceIdentity={`${row.id}:${mediaVersion}`}
              poster={poster}
              posterBlurHash={row.thumbBlurHash}
              fallbackSeed={row.steamgriddbId}
              aspectRatio={aspectRatio}
              maxDisplayHeight="100%"
              controls={false}
              onVideoClick={() => playback.togglePlayback()}
              playerRef={playerRef}
              onTimeUpdate={playback.handleTimeUpdate}
              onPlayingChange={playback.setPlaying}
              onEnded={playback.handleEnded}
              className="overflow-hidden rounded-md"
            />
            <LibraryEntryNavButton side="left" target={prevEntry} />
            <LibraryEntryNavButton side="right" target={nextEntry} />
          </LibraryMediaStage>

          {processing ? (
            <ClipProcessingNotice progress={row.encodeProgress} />
          ) : (
            <>
              <TrimTransportControls playback={playback} />

              <LibraryTrimBar
                frames={filmstrip.frames}
                frameAspect={filmstrip.aspect}
                durationMs={playback.durationMs}
                startMs={trim.startMs}
                endMs={trim.endMs}
                currentMs={playback.currentMs}
                onSeek={(sourceMs) => {
                  playerRef.current?.pause()
                  playback.seek(sourceMs)
                }}
                onStartChange={playback.handleTrimStartChange}
                onEndChange={playback.handleTrimEndChange}
                onMove={playback.handleTrimMove}
              />
            </>
          )}
        </section>

        {/* ── Sheet: Details / Comments tabs. ── */}
        <aside className="border-border bg-surface/60 flex min-w-0 flex-col self-stretch overflow-hidden rounded-md border lg:min-h-0">
          <ClipEditorTabs
            row={row}
            localItem={localItem}
            canManage={canManage}
            onRequestDelete={deleteFlow.openDialog}
            deleting={deleteFlow.pending}
            canSaveTrim={canSaveTrim}
            trimPending={trimMutation.isPending}
            onSaveTrim={handleSaveTrim}
          />
        </aside>
      </div>

      <DeleteClipDialog
        open={deleteFlow.open}
        onOpenChange={deleteFlow.setOpen}
        pending={deleteFlow.pending}
        localItem={localItem}
        title={row.title}
        onConfirm={deleteFlow.confirm}
      />
    </section>
  )
}

function useServerBackedClipDelete({
  row,
  localItem,
  prevEntry,
  nextEntry,
}: {
  row: ClipRow
  localItem: Parameters<typeof DeleteClipDialog>[0]["localItem"]
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
}) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const deleteMutation = useDeleteClipMutation()
  const [open, setOpen] = React.useState(false)
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const finishDelete = React.useCallback(() => {
    setOpen(false)
    const fallback = nextEntry ?? prevEntry
    if (fallback) navigateToEntry(fallback)
    else void navigate({ to: "/library", replace: true })
  }, [navigate, navigateToEntry, nextEntry, prevEntry])

  const confirm = React.useCallback(
    (deleteLocal: boolean) => {
      deleteMutation.mutate(
        { clipId: row.id },
        {
          onSuccess: async () => {
            if (localItem) {
              await finishLocalClipDelete({
                deleteLocal,
                localItem,
                serverId: row.id,
                setDeletingLocal,
              })
            } else {
              toast.success("Clip deleted")
            }
            finishDelete()
          },
          onError: () => toast.error("Couldn't delete clip"),
        },
      )
    },
    [deleteMutation, finishDelete, localItem, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: React.useCallback(() => setOpen(true), []),
    pending,
    confirm,
  }
}

async function finishLocalClipDelete({
  deleteLocal,
  localItem,
  serverId,
  setDeletingLocal,
}: {
  deleteLocal: boolean
  localItem: NonNullable<Parameters<typeof DeleteClipDialog>[0]["localItem"]>
  serverId: string
  setDeletingLocal: (deleting: boolean) => void
}): Promise<void> {
  if (deleteLocal) {
    setDeletingLocal(true)
    try {
      await deleteLocalLibraryCopy(localItem)
      toast.success("Clip deleted from server and this device")
    } catch (cause) {
      clientLogger.warn(
        "[library] Failed to delete local clip copy after server delete.",
        cause,
      )
      await detachLocalServerLink({ item: localItem, serverId }).catch(
        () => undefined,
      )
      toast.error(
        "Clip deleted from server, but the local copy couldn't be removed",
      )
    } finally {
      setDeletingLocal(false)
    }
    return
  }

  try {
    await detachLocalServerLink({ item: localItem, serverId })
    toast.success("Clip deleted from server")
  } catch (cause) {
    clientLogger.warn(
      "[library] Failed to detach local clip link after server delete.",
      cause,
    )
    toast.error(
      "Clip deleted from server, but the local sync link couldn't be cleared",
    )
  }
}

function clipEditorMediaVersion(row: ClipRow): string {
  return [
    row.status,
    row.sourceContentType ?? "",
    row.sourceVideoCodec ?? "",
    row.sourceAudioCodec ?? "",
    row.sourceSizeBytes ?? "",
    row.durationMs ?? "",
    row.width ?? "",
    row.height ?? "",
    row.thumbKey ?? "",
    row.thumbBlurHash ?? "",
  ].join(":")
}

function ClipProcessingNotice({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))
  return (
    <div className="border-border bg-surface/60 flex items-center gap-3 rounded-md border p-3">
      <Spinner className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          Processing clip...
        </p>
        <Progress value={clamped} className="mt-1.5" />
      </div>
      <span className="text-foreground-muted text-sm tabular-nums">
        {clamped}%
      </span>
    </div>
  )
}

/**
 * Action row under the trimmer: editor hand-off and download. A pending trim
 * saves through the Details sheet's Save button, together with the fields.
 */
function DeleteClipDialog({
  open,
  onOpenChange,
  pending,
  localItem,
  title,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  localItem: Parameters<typeof DeleteServerBackedDialog>[0]["localItem"]
  title: string
  onConfirm: (deleteLocal: boolean) => void
}) {
  return (
    <DeleteServerBackedDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={title}
      noun="clip"
      localItem={localItem}
      onConfirm={onConfirm}
    />
  )
}
