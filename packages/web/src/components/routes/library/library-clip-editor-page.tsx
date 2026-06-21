import { type ClipRow, clipStreamUrl, clipThumbnailUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Progress } from "@alloy/ui/components/progress"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CloudIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { VideoPlayer } from "@/components/video/video-player"
import { useSession } from "@/lib/auth-client"
import {
  invalidateDeletedClipCaches,
  removeClipDetailFromCache,
  useClipQuery,
  useDeleteClipMutation,
  seedClipDetailInCache,
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
  clearLibraryHandoffPoster,
  LibraryHandoffPosterOverlay,
  type LibraryHandoffPoster,
  readLibraryHandoffPoster,
  setLibraryHandoffPoster,
} from "./library-handoff-poster"
import { finishLocalClipDelete } from "./library-local-actions"
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
  const query = useClipQuery(clipId, { keepPreviousData: false })
  const row = query.data?.id === clipId ? query.data : undefined

  if (!row) {
    return (
      <AppMain>
        {query.isError ? (
          <LibraryEmpty
            icon={<CloudIcon />}
            title={t("Clip not found")}
            description={t(
              "It may have been deleted, or you may not have access to it.",
            )}
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
  const { canManage, isOwner } = useClipEditorPermissions(row)
  const processing = row.status !== "ready" || row.encodeProgress < 100
  const canTrim = isOwner && !processing
  const playback = useTrimPlayback({
    initialDurationMs: row.durationMs ?? 0,
    canTrim,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const trimMutation = useTrimClipMutation()
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending
  const media = useClipEditorMedia(row, processing)
  const deleteFlow = useServerBackedClipDelete({
    row,
    localItem,
    prevEntry,
    nextEntry,
    handoffPoster: media.handoffPoster,
  })

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
          toast.success(t("Trim saved — the clip is reprocessing"))
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
        <ClipEditorStage
          row={row}
          media={media}
          playback={playback}
          processing={processing}
          prevEntry={prevEntry}
          nextEntry={nextEntry}
        />

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

function useClipEditorPermissions(row: ClipRow) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null

  return {
    canManage:
      viewerId !== null &&
      (viewerId === row.authorId || viewerRole === "admin"),
    isOwner: viewerId !== null && viewerId === row.authorId,
  }
}

function useClipEditorMedia(row: ClipRow, processing: boolean) {
  const mediaVersion = clipEditorMediaVersion(row)
  const streamSrc = `${clipStreamUrl(row.id, "source", apiOrigin())}&v=${encodeURIComponent(mediaVersion)}`
  const filmstrip = useMediaFilmstrip(processing ? null : streamSrc)
  const poster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : undefined
  const aspectRatio = mediaAspectRatio(row.width, row.height)
  const handoffPoster = useMemo<LibraryHandoffPoster>(
    () => ({
      src: poster,
      blurHash: row.thumbBlurHash,
      fallbackSeed: row.steamgriddbId ?? row.id,
    }),
    [poster, row.id, row.steamgriddbId, row.thumbBlurHash],
  )
  const [publishHandoffPoster, setPublishHandoffPoster] = useState(() =>
    readLibraryHandoffPoster(row.id),
  )
  const [cloudFrameReady, setCloudFrameReady] = useState(
    () => publishHandoffPoster === null,
  )

  useEffect(() => {
    setPublishHandoffPoster(readLibraryHandoffPoster(row.id))
  }, [row.id])
  useEffect(() => {
    setCloudFrameReady(publishHandoffPoster === null)
  }, [publishHandoffPoster])
  useEffect(() => {
    if (publishHandoffPoster && cloudFrameReady) {
      clearLibraryHandoffPoster(row.id)
    }
  }, [cloudFrameReady, publishHandoffPoster, row.id])

  return {
    aspectRatio,
    cloudFrameReady,
    filmstrip,
    handoffPoster,
    mediaVersion,
    poster,
    publishHandoffPoster,
    setCloudFrameReady,
    streamSrc,
  }
}

type ClipEditorMediaState = ReturnType<typeof useClipEditorMedia>
type ClipEditorPlaybackState = ReturnType<typeof useTrimPlayback>

function ClipEditorStage({
  row,
  media,
  playback,
  processing,
  prevEntry,
  nextEntry,
}: {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  processing: boolean
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
}) {
  return (
    <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
      <LibraryMediaStage aspectRatio={media.aspectRatio}>
        <VideoPlayer
          src={media.streamSrc}
          sourceIdentity={`${row.id}:${media.mediaVersion}`}
          poster={media.poster}
          posterBlurHash={row.thumbBlurHash}
          fallbackSeed={row.steamgriddbId ?? row.id}
          aspectRatio={media.aspectRatio}
          maxDisplayHeight="100%"
          controls={false}
          onVideoClick={() => playback.togglePlayback()}
          playerRef={playback.playerRef}
          onTimeUpdate={playback.handleTimeUpdate}
          onPlayingChange={playback.setPlaying}
          onFrameReady={() => media.setCloudFrameReady(true)}
          onEnded={playback.handleEnded}
          className="overflow-hidden rounded-md"
        />
        <LibraryEntryNavButton side="left" target={prevEntry} />
        <LibraryEntryNavButton side="right" target={nextEntry} />
        <LibraryHandoffPosterOverlay
          poster={media.publishHandoffPoster}
          ready={media.cloudFrameReady}
        />
      </LibraryMediaStage>

      {processing ? (
        <ClipProcessingNotice progress={row.encodeProgress} />
      ) : (
        <ClipEditorTrimControls media={media} playback={playback} />
      )}
    </section>
  )
}

function ClipEditorTrimControls({
  media,
  playback,
}: {
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
}) {
  return (
    <>
      <TrimTransportControls playback={playback} />
      <LibraryTrimBar
        frames={media.filmstrip.frames}
        frameAspect={media.filmstrip.aspect}
        durationMs={playback.durationMs}
        startMs={playback.trim.startMs}
        endMs={playback.trim.endMs}
        currentMs={playback.currentMs}
        onSeek={(sourceMs) => {
          playback.playerRef.current?.pause()
          playback.seek(sourceMs)
        }}
        onStartChange={playback.handleTrimStartChange}
        onEndChange={playback.handleTrimEndChange}
        onMove={playback.handleTrimMove}
      />
    </>
  )
}

function useServerBackedClipDelete({
  row,
  localItem,
  prevEntry,
  nextEntry,
  handoffPoster,
}: {
  row: ClipRow
  localItem: Parameters<typeof DeleteClipDialog>[0]["localItem"]
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  handoffPoster: LibraryHandoffPoster
}) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteClipMutation()
  const [open, setOpen] = useState(false)
  const [deletingLocal, setDeletingLocal] = useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const finishDelete = useCallback(
    async ({
      keptLocalItem,
    }: {
      keptLocalItem: Parameters<typeof DeleteClipDialog>[0]["localItem"]
    }) => {
      setOpen(false)
      if (keptLocalItem) {
        setLibraryHandoffPoster(keptLocalItem.id, handoffPoster)
        await navigate({
          to: "/library/$captureId",
          params: { captureId: keptLocalItem.id },
          replace: true,
        })
        removeClipDetailFromCache(queryClient, row.id)
        invalidateDeletedClipCaches(queryClient)
        return
      }

      const fallback = nextEntry ?? prevEntry
      if (fallback) {
        if (fallback.type === "cloud") {
          seedClipDetailInCache(queryClient, fallback.row)
        }
        navigateToEntry(fallback)
      } else void navigate({ to: "/library", replace: true })
    },
    [
      handoffPoster,
      navigate,
      navigateToEntry,
      nextEntry,
      prevEntry,
      queryClient,
      row.id,
    ],
  )

  const confirm = useCallback(
    (deleteLocal: boolean) => {
      const keepLocalCopy = Boolean(localItem && !deleteLocal)
      deleteMutation.mutate(
        {
          clipId: row.id,
          removeDetail: !keepLocalCopy,
          deferInvalidation: keepLocalCopy,
        },
        {
          onSuccess: async () => {
            const keptLocalItem = localItem && !deleteLocal ? localItem : null
            if (localItem) {
              await finishLocalClipDelete({
                deleteLocal,
                localItem,
                serverId: row.id,
                setDeletingLocal,
              })
            } else {
              toast.success(t("Clip deleted"))
            }
            await finishDelete({ keptLocalItem })
          },
          onError: () => toast.error(t("Couldn't delete clip")),
        },
      )
    },
    [deleteMutation, finishDelete, localItem, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: useCallback(() => setOpen(true), []),
    pending,
    confirm,
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
          {t("Processing clip...")}
        </p>
        <Progress value={clamped} className="mt-1.5" />
      </div>
      <span className="text-foreground-muted text-sm tabular-nums">
        {clamped}
        {"%"}
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
