import {
  type GameRow,
  type StagingRecordingRow,
  stagingStreamUrl,
  stagingThumbnailUrl,
  type UserSearchResult,
} from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Progress } from "@alloy/ui/components/progress"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import {
  ChevronUpIcon,
  ClapperboardIcon,
  CloudIcon,
  GlobeIcon,
  Link2Icon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { VideoPlayer } from "@/components/video/video-player"
import { normalizeClipDescription, normalizeClipTitle } from "@/lib/clip-fields"
import type { RecordingLibraryItem } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"
import {
  useDeleteStagingMutation,
  usePublishStagingMutation,
  useStagingQuery,
  useTrimStagingMutation,
  useUpdateStagingMutation,
} from "@/lib/staging-queries"

import { DeleteServerBackedDialog } from "./library-delete-dialog"
import {
  BackToLibraryButton,
  TrimTransportControls,
} from "./library-editor-shared"
import {
  LibraryEntryNavButton,
  useLibraryEditorShortcuts,
  useLibraryEntryNavigation,
  useNavigateToLibraryEntry,
} from "./library-entry-navigation"
import { StagingFileLocation } from "./library-file-location"
import {
  deleteLocalLibraryCopy,
  detachLocalServerLink,
  normalizeLocalPublishedStagingLink,
} from "./library-local-actions"
import { LibraryMediaStage, mediaAspectRatio } from "./library-media-stage"
import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

function gameRowFromStaging(row: StagingRecordingRow): GameRow | null {
  const ref = row.gameRef
  if (!ref) return null
  return {
    id: ref.id,
    steamgriddbId: ref.steamgriddbId,
    name: ref.name,
    slug: ref.slug,
    releaseDate: ref.releaseDate,
    heroUrl: ref.heroUrl,
    heroBlurHash: ref.heroBlurHash,
    gridUrl: ref.gridUrl,
    gridBlurHash: ref.gridBlurHash,
    logoUrl: ref.logoUrl,
    iconUrl: ref.iconUrl,
  }
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

/**
 * Edit view for an owner-only staging recording: the same stage-and-trimmer
 * layout as the clip editor, but the right sheet edits draft metadata (no
 * game required) and the action row publishes it into a real clip.
 */
export function LibraryStagingEditorPage({
  recordingId,
}: {
  recordingId: string
}) {
  const query = useStagingQuery(recordingId)
  const row = query.data

  if (!row) {
    return (
      <AppMain>
        {query.isError ? (
          <LibraryEmpty
            icon={<CloudIcon />}
            title="Recording not found"
            description="It may have been posted, deleted, or belong to another account."
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
      <StagingEditorBody key={row.id} row={row} />
    </AppMain>
  )
}

function StagingEditorBody({ row }: { row: StagingRecordingRow }) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const navigation = useLibraryEntryNavigation({
    type: "staging",
    id: row.id,
  })
  const { localItem, prevEntry, nextEntry } = navigation
  const processing = row.status !== "ready" || row.encodeProgress < 100
  const canTrim = !processing

  const playback = useTrimPlayback({
    initialDurationMs: row.durationMs ?? 0,
    canTrim,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback

  const trimMutation = useTrimStagingMutation()
  const deleteMutation = useDeleteStagingMutation()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deletingLocal, setDeletingLocal] = React.useState(false)
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending

  const streamSrc = `${stagingStreamUrl(row.id, "source", apiOrigin())}&v=${encodeURIComponent(row.updatedAt)}`
  const filmstrip = useMediaFilmstrip(processing ? null : streamSrc)
  const poster = row.thumbKey
    ? stagingThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : undefined
  const aspectRatio = mediaAspectRatio(row.width, row.height)

  useLibraryEditorShortcuts({
    prevEntry,
    nextEntry,
    onDelete: () => setDeleteDialogOpen(true),
    togglePlayback: playback.togglePlayback,
  })

  const handleSaveTrim = () => {
    if (!canSaveTrim) return
    playerRef.current?.pause()
    trimMutation.mutate(
      {
        id: row.id,
        startMs: Math.round(trim.startMs),
        endMs: Math.round(trim.endMs),
      },
      {
        onSuccess: () => {
          toast.success("Trim saved — the recording is reprocessing")
          playback.setTrim({ startMs: 0, endMs: 0 })
          playback.setCurrentMs(0)
        },
        onError: (cause) =>
          toast.error(cause.message || "Couldn't trim the recording"),
      },
    )
  }

  const handleDelete = (deleteLocal: boolean) => {
    deleteMutation.mutate(
      { id: row.id },
      {
        onSuccess: async () => {
          if (localItem) {
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
          } else {
            toast.success("Recording deleted")
          }
          setDeleteDialogOpen(false)
          const fallback = nextEntry ?? prevEntry
          if (fallback) navigateToEntry(fallback)
          else void navigate({ to: "/library", replace: true })
        },
        onError: () => toast.error("Couldn't delete recording"),
      },
    )
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <LibraryMediaStage aspectRatio={aspectRatio}>
            <VideoPlayer
              src={streamSrc}
              sourceIdentity={`${row.id}:${row.updatedAt}`}
              poster={poster}
              posterBlurHash={row.thumbBlurHash}
              fallbackSeed={row.steamgriddbId ?? undefined}
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
            <StagingProcessingNotice progress={row.encodeProgress} />
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

        <aside className="border-border bg-surface/60 flex min-w-0 flex-col self-stretch overflow-hidden rounded-md border lg:min-h-0">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <StagingDetailsForm
              row={row}
              localItem={localItem}
              canSaveTrim={canSaveTrim}
              trimPending={trimMutation.isPending}
              onSaveTrim={handleSaveTrim}
              deleting={deleteMutation.isPending}
              onRequestDelete={() => setDeleteDialogOpen(true)}
            />
          </div>
        </aside>
      </div>

      <DeleteStagingDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        pending={deleteMutation.isPending || deletingLocal}
        title={row.title}
        localItem={localItem}
        onConfirm={handleDelete}
      />
    </section>
  )
}

function StagingProcessingNotice({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))
  return (
    <div className="border-border bg-surface/60 flex items-center gap-3 rounded-md border p-3">
      <Spinner className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          Processing recording...
        </p>
        <Progress value={clamped} className="mt-1.5" />
      </div>
      <span className="text-foreground-muted text-sm tabular-nums">
        {clamped}%
      </span>
    </div>
  )
}

function StagingDetailsForm({
  row,
  localItem,
  canSaveTrim,
  trimPending,
  onSaveTrim,
  deleting,
  onRequestDelete,
}: {
  row: StagingRecordingRow
  localItem: RecordingLibraryItem | null
  canSaveTrim: boolean
  trimPending: boolean
  onSaveTrim: () => void
  deleting: boolean
  onRequestDelete: () => void
}) {
  const navigate = useNavigate()
  const [title, setTitle] = React.useState(row.title)
  const [description, setDescription] = React.useState(row.description ?? "")
  const [game, setGame] = React.useState<GameRow | null>(() =>
    gameRowFromStaging(row),
  )
  const [mentions, setMentions] = React.useState<UserSearchResult[]>([])
  const [tags, setTags] = React.useState<string[]>(row.tags)
  const [publishInvalid, setPublishInvalid] = React.useState(false)

  const updateMutation = useUpdateStagingMutation()
  const publishMutation = usePublishStagingMutation()
  const draftSaving = updateMutation.isPending
  const publishing = publishMutation.isPending

  const trimmedTitle = normalizeClipTitle(title)
  const trimmedDescription = normalizeClipDescription(description)
  const currentDescription = row.description ?? ""
  const titleChanged = trimmedTitle !== row.title && trimmedTitle.length > 0
  const descriptionChanged = trimmedDescription !== currentDescription.trim()
  const gameChanged = (game?.steamgriddbId ?? null) !== row.steamgriddbId
  const tagsChanged = !sameIdSet(tags, row.tags)
  const dirty = titleChanged || descriptionChanged || gameChanged || tagsChanged
  const titleInvalid = trimmedTitle.length === 0

  const buildDraftInput = () => {
    const input: Parameters<typeof updateMutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (gameChanged) {
      if (game) input.steamgriddbId = game.steamgriddbId
      else input.clearGame = true
    }
    if (tagsChanged) input.tags = tags
    return input
  }

  const publish = async (privacy: "public" | "unlisted") => {
    if (draftSaving || publishing || trimPending) return
    if (titleInvalid) return
    if (canSaveTrim) {
      if (dirty) {
        try {
          await updateMutation.mutateAsync({
            id: row.id,
            input: buildDraftInput(),
          })
        } catch (cause) {
          toast.error(
            cause instanceof Error ? cause.message : "Couldn't save changes",
          )
          return
        }
      }
      onSaveTrim()
      return
    }
    if (!game) {
      setPublishInvalid(true)
      toast.error("Pick a game to post")
      return
    }
    publishMutation.mutate(
      {
        id: row.id,
        input: {
          steamgriddbId: game.steamgriddbId,
          privacy,
          title: trimmedTitle,
          description: trimmedDescription,
          tags,
          mentionedUserIds: mentions.map((m) => m.id),
        },
      },
      {
        onSuccess: ({ clipId }) => {
          toast.success(
            privacy === "public" ? "Posted to your profile" : "Posted",
          )
          if (localItem) {
            void normalizeLocalPublishedStagingLink({ item: localItem, clipId })
          }
          // Replace so Back doesn't return to the now-consumed staging route.
          void navigate({
            to: "/library/c/$clipId",
            params: { clipId },
            replace: true,
          })
        },
        onError: (cause) => toast.error(cause.message || "Couldn't post"),
      },
    )
  }

  const busy = draftSaving || publishing || trimPending

  return (
    <>
      <ClipMetadataEditor
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        game={game}
        onGameChange={(next) => {
          setGame(next)
          if (next) setPublishInvalid(false)
        }}
        mentions={mentions}
        onMentionsChange={setMentions}
        tags={tags}
        onTagsChange={setTags}
        disabled={busy}
        titleInvalid={titleInvalid}
        gameInvalid={publishInvalid}
      />

      <StagingFileLocation row={row} localItem={localItem} />

      <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={deleting || busy}
          onClick={onRequestDelete}
        >
          <Trash2Icon />
          Delete
        </Button>
        <div className="flex items-center">
          <Button
            type="button"
            variant="primary"
            disabled={busy || titleInvalid}
            className="h-10 rounded-r-none sm:h-8"
            onClick={() => {
              void publish("public")
            }}
          >
            <GlobeIcon />
            {publishing ? "Posting…" : "Post"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="primary"
                  size="icon"
                  disabled={busy || (titleInvalid && !localItem)}
                  aria-label="More post options"
                  className="border-l-accent-hover size-10 rounded-l-none sm:size-8"
                />
              }
            >
              <ChevronUpIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-52">
              {localItem ? (
                <DropdownMenuItem
                  onClick={() => {
                    void navigate({
                      to: "/editor",
                      search: { capture: localItem.id },
                    })
                  }}
                >
                  <ClapperboardIcon className="size-4" />
                  Open in Editor
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={titleInvalid}
                onClick={() => {
                  void publish("unlisted")
                }}
              >
                <Link2Icon className="size-4" />
                Create Link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  )
}

function DeleteStagingDialog({
  open,
  onOpenChange,
  pending,
  title,
  localItem,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  title: string
  localItem: RecordingLibraryItem | null
  onConfirm: (deleteLocal: boolean) => void
}) {
  return (
    <DeleteServerBackedDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={title}
      noun="recording"
      localItem={localItem}
      onConfirm={onConfirm}
    />
  )
}
