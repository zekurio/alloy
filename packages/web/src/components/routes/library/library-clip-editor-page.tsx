import {
  type ClipRow,
  clipOriginalFileUrl,
  clipRenditionFileUrl,
  clipScrubberFileUrl,
  clipThumbnailUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { Progress } from "@alloy/ui/components/progress"
import { Spinner } from "@alloy/ui/components/spinner"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CloudIcon, ImageIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { useUploadQueue } from "@/components/upload/upload-flow-context"
import { VideoPlayer } from "@/components/video/video-player"
import { useSession } from "@/lib/auth-client"
import { useCapturePoster } from "@/lib/capture-poster"
import {
  invalidateDeletedClipCaches,
  removeClipDetailFromCache,
  useClipQuery,
  useDeleteClipMutation,
  seedClipDetailInCache,
  useSetClipPosterMutation,
  useTrimClipMutation,
} from "@/lib/clip-queries"
import type { RecordingLibraryItem } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { canPlaySource } from "@/lib/media-capability"
import { useSpriteSheetFilmstrip } from "@/lib/media-filmstrip"

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
    initialDurationMs: row.sourceDurationMs ?? row.durationMs ?? 0,
    initialTrim:
      row.trimStartMs !== null && row.trimEndMs !== null
        ? { startMs: row.trimStartMs, endMs: row.trimEndMs }
        : undefined,
    canTrim,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const trimMutation = useTrimClipMutation()
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending
  const media = useClipEditorMedia(row, processing, localItem)
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
          canManage={canManage}
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

function useClipEditorMedia(
  row: ClipRow,
  processing: boolean,
  localItem: RecordingLibraryItem | null,
) {
  // Version the stream URL by the published source bytes only — deriving it
  // from thumb/status fields would reload the <video> mid-playback whenever a
  // background detail refetch lands.
  const mediaVersion = row.sourceVersion ?? ""
  const streamSrc = clipOriginalFileUrl(row.id, apiOrigin())
  const sourcePlayable = canPlaySource(
    row.sourceContentType ?? "video/mp4",
    row.sourceCodecs ?? "",
  )
  const playableRendition =
    sourcePlayable || row.trimStartMs !== null
      ? undefined
      : row.renditions.find((rendition) =>
          canPlaySource("video/mp4", rendition.codecs),
        )
  // For untrimmed clips, rendition time maps 1:1 to source time, so trim math
  // stays anchored to the original source even when previewing a rendition.
  const previewSrc = sourcePlayable
    ? streamSrc
    : playableRendition
      ? clipRenditionFileUrl(
          row.id,
          playableRendition.name,
          apiOrigin(),
          playableRendition.version,
        )
      : null
  const filmstrip = useSpriteSheetFilmstrip(
    processing ? null : clipScrubberFileUrl(row.id, apiOrigin()),
  )
  const serverPoster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : undefined
  const localPoster = useCapturePoster({
    id: localItem?.id ?? "",
    mediaUrl: localItem?.mediaUrl ?? null,
    thumbnailUrl: localItem?.thumbnailUrl ?? null,
    durationMs: localItem?.durationMs ?? null,
    enabled: processing && Boolean(localItem),
  })
  // While the server still owes us a thumbnail, the upload queue may hold an
  // existing local library poster for the pending card.
  const uploadQueue = useUploadQueue().queue
  const queueEntry = processing
    ? uploadQueue.find((item) => item.kind === "upload" && item.id === row.id)
    : undefined
  const queuePoster =
    queueEntry?.thumbUrl ?? queueEntry?.thumbFallbackUrl ?? undefined
  const poster =
    serverPoster ?? localPoster ?? localItem?.thumbnailUrl ?? queuePoster
  const posterBlurHash = row.thumbBlurHash ?? localItem?.thumbBlurHash ?? null
  const fallbackSeed = row.gameId ?? localItem?.groupLabel ?? row.id
  const playbackSrc = processing ? (localItem?.mediaUrl ?? null) : previewSrc
  const previewUnavailable =
    !processing &&
    Boolean(row.sourceContentType || row.renditions.length > 0) &&
    previewSrc === null
  const aspectRatio = mediaAspectRatio(
    row.width ?? localItem?.width,
    row.height ?? localItem?.height,
  )
  const handoffPoster = useMemo<LibraryHandoffPoster>(
    () => ({
      src: poster,
      blurHash: posterBlurHash,
      fallbackSeed,
    }),
    [fallbackSeed, poster, posterBlurHash],
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
    playbackSrc,
    poster,
    posterBlurHash,
    previewUnavailable,
    publishHandoffPoster,
    setCloudFrameReady,
    streamSrc,
    fallbackSeed,
  }
}

type ClipEditorMediaState = ReturnType<typeof useClipEditorMedia>
type ClipEditorPlaybackState = ReturnType<typeof useTrimPlayback>

function ClipEditorStage({
  row,
  media,
  playback,
  processing,
  canManage,
  prevEntry,
  nextEntry,
}: {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  processing: boolean
  canManage: boolean
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
}) {
  return (
    <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
      <LibraryMediaStage aspectRatio={media.aspectRatio}>
        {media.playbackSrc ? (
          <VideoPlayer
            src={media.playbackSrc}
            sourceIdentity={`${row.id}:${media.mediaVersion}:${media.playbackSrc}`}
            poster={media.poster}
            posterBlurHash={media.posterBlurHash}
            fallbackSeed={media.fallbackSeed}
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
        ) : (
          <ClipEditorPreviewPlaceholder media={media} />
        )}
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
        <ClipEditorTrimControls
          clipId={row.id}
          media={media}
          playback={playback}
          canManage={canManage}
        />
      )}
    </section>
  )
}

function ClipEditorPreviewPlaceholder({
  media,
}: {
  media: ClipEditorMediaState
}) {
  const poster = useImageLoaded(media.poster)
  return (
    <div className="relative size-full overflow-hidden rounded-md">
      {/* Fade the gradient out under the painted poster so its letterbox
          bars show the page background, matching video playback. */}
      <MediaPlaceholder
        seed={media.fallbackSeed}
        blurHash={media.posterBlurHash}
        aspectRatio={media.aspectRatio}
        className={cn(
          "transition-opacity duration-200 ease-out",
          poster.loaded ? "opacity-0" : "opacity-100",
        )}
      />
      {media.poster ? (
        <img
          ref={poster.ref}
          src={media.poster}
          alt=""
          className="absolute inset-0 size-full object-contain"
          decoding="async"
          onLoad={poster.markLoaded}
        />
      ) : null}
      {media.previewUnavailable ? (
        <>
          <div aria-hidden className="absolute inset-0 bg-black/40" />
          <span className="relative z-10 flex size-full items-center justify-center px-4 text-center text-sm text-white/80">
            {t(
              "Preview unavailable in this browser — scrubbing and trimming still work.",
            )}
          </span>
        </>
      ) : null}
    </div>
  )
}

function ClipEditorTrimControls({
  clipId,
  media,
  playback,
  canManage,
}: {
  clipId: string
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  canManage: boolean
}) {
  return (
    <>
      <TrimTransportControls
        playback={playback}
        trailing={
          canManage ? (
            <SetPosterButton clipId={clipId} playback={playback} />
          ) : undefined
        }
      />
      <LibraryTrimBar
        frames={media.filmstrip.frames}
        frameAspect={media.filmstrip.aspect}
        durationMs={playback.durationMs}
        startMs={playback.trim.startMs}
        endMs={playback.trim.endMs}
        subscribeCurrentMs={playback.subscribeCurrentMs}
        getCurrentMs={playback.getCurrentMs}
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

/**
 * Publishes the paused frame as the clip's poster — the server extracts it
 * from the stored source at the playhead's source-time position.
 */
function SetPosterButton({
  clipId,
  playback,
}: {
  clipId: string
  playback: ClipEditorPlaybackState
}) {
  const mutation = useSetClipPosterMutation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => {
        playback.playerRef.current?.pause()
        mutation.mutate(
          { clipId, timeMs: Math.round(playback.getCurrentMs()) },
          {
            onSuccess: () => toast.success(t("Poster updated")),
            onError: (cause) =>
              toast.error(cause.message || t("Couldn't update the poster")),
          },
        )
      }}
    >
      {mutation.isPending ? <Spinner className="size-4" /> : <ImageIcon />}
      {t("Use frame as poster")}
    </Button>
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
