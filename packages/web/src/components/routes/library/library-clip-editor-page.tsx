import { type ClipRow, clipStreamUrl, clipThumbnailUrl } from "@alloy/api"
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
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Progress } from "@alloy/ui/components/progress"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import { ClapperboardIcon, CloudIcon, ScissorsIcon } from "lucide-react"
import * as React from "react"

import { VideoPlayer } from "@/components/video/video-player"
import { useSession } from "@/lib/auth-client"
import {
  useClipQuery,
  useDeleteClipMutation,
  useTrimClipMutation,
} from "@/lib/clip-queries"
import { alloyDesktop } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"

import { ClipEditorTabs } from "./library-clip-editor-details"
import {
  BackToLibraryButton,
  TrimTransportControls,
} from "./library-editor-shared"
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
    <AppMain>
      {/* Keyed by clip id: edits reset when navigating between clips, but
          survive background detail refetches. */}
      <ClipEditorBody key={row.id} row={row} />
    </AppMain>
  )
}

/** Space toggles playback, like the capture editor. */
function useSpaceHotkey(togglePlayback: () => void) {
  const togglePlaybackRef = React.useRef(togglePlayback)
  togglePlaybackRef.current = togglePlayback
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable ||
          target.closest('[role="slider"]') ||
          target.closest('[role="dialog"]'))
      ) {
        return
      }
      if (event.key === " ") {
        event.preventDefault()
        togglePlaybackRef.current()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

function ClipEditorBody({ row }: { row: ClipRow }) {
  const navigate = useNavigate()
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
  const deleteMutation = useDeleteClipMutation()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending

  // Versioned by updatedAt so a finished server trim busts the media cache
  // and the player reloads the newly cut source.
  const streamSrc = `${clipStreamUrl(row.id, "source", apiOrigin())}&v=${encodeURIComponent(row.updatedAt)}`
  const poster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : undefined

  useSpaceHotkey(playback.togglePlayback)

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

  const handleDelete = () => {
    deleteMutation.mutate(
      { clipId: row.id },
      {
        onSuccess: () => {
          toast.success("Clip deleted")
          void navigate({ to: "/library" })
        },
        onError: () => toast.error("Couldn't delete clip"),
      },
    )
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        {/* ── Stage: player, transport, and the trimmer. ── */}
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <div className="relative flex aspect-video w-full items-center justify-center lg:aspect-auto lg:min-h-0 lg:flex-1">
            <VideoPlayer
              src={streamSrc}
              sourceIdentity={`${row.id}:${row.updatedAt}`}
              poster={poster}
              posterBlurHash={row.thumbBlurHash}
              fallbackSeed={row.steamgriddbId}
              aspectRatio={
                row.width && row.height ? row.width / row.height : undefined
              }
              maxDisplayHeight="100%"
              controls={false}
              onVideoClick={() => playback.togglePlayback()}
              playerRef={playerRef}
              onTimeUpdate={playback.handleTimeUpdate}
              onPlayingChange={playback.setPlaying}
              onEnded={playback.handleEnded}
              className="overflow-hidden rounded-md"
            />
          </div>

          {processing ? (
            <ClipProcessingNotice progress={row.encodeProgress} />
          ) : (
            <>
              <TrimTransportControls playback={playback} />

              <LibraryTrimBar
                frames={[]}
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
              />

              <ClipEditorActions
                clipId={row.id}
                isOwner={isOwner}
                trimmed={trimmed}
                canSaveTrim={canSaveTrim}
                trimPending={trimMutation.isPending}
                onSaveTrim={handleSaveTrim}
              />
            </>
          )}
        </section>

        {/* ── Sheet: Details / Comments tabs. ── */}
        <aside className="border-border bg-surface/60 flex min-w-0 flex-col self-stretch overflow-hidden rounded-md border lg:min-h-0">
          <ClipEditorTabs
            row={row}
            canManage={canManage}
            onRequestDelete={() => setDeleteDialogOpen(true)}
            deleting={deleteMutation.isPending}
          />
        </aside>
      </div>

      <DeleteClipDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        pending={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </section>
  )
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

/** Action row under the trimmer: editor hand-off and the destructive trim. */
function ClipEditorActions({
  clipId,
  isOwner,
  trimmed,
  canSaveTrim,
  trimPending,
  onSaveTrim,
}: {
  clipId: string
  isOwner: boolean
  trimmed: boolean
  canSaveTrim: boolean
  trimPending: boolean
  onSaveTrim: () => void
}) {
  const navigate = useNavigate()
  const desktop = alloyDesktop()
  return (
    <div className="flex flex-wrap items-center gap-3">
      {desktop ? (
        <Button
          type="button"
          variant="secondary"
          disabled={trimPending}
          onClick={() => {
            void navigate({
              to: "/editor",
              search: { capture: clipId },
            })
          }}
        >
          <ClapperboardIcon />
          Open in Editor
        </Button>
      ) : null}
      {isOwner ? (
        <Button
          type="button"
          variant="primary"
          disabled={!canSaveTrim}
          onClick={onSaveTrim}
        >
          <ScissorsIcon />
          {trimPending ? "Trimming..." : "Save trim"}
        </Button>
      ) : null}
      {trimmed && isOwner ? (
        <p className="text-foreground-faint text-sm">
          Saving the trim cuts the uploaded clip permanently.
        </p>
      ) : null}
    </div>
  )
}

function DeleteClipDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
          <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete clip"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
