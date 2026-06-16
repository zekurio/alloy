import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
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
import { BlurHashCanvas } from "@alloy/ui/components/blurhash-canvas"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import {
  ChevronUpIcon,
  ClapperboardIcon,
  HardDriveIcon,
  ImageIcon,
  Link2Icon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import * as React from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { VideoPlayer } from "@/components/video/video-player"
import { absoluteClipHref } from "@/lib/app-paths"
import { useCapturePoster } from "@/lib/capture-poster"
import {
  CLIP_DESCRIPTION_MAX,
  formatTags,
  normalizeClipDescription,
  normalizeClipTitle,
  parseTagString,
} from "@/lib/clip-fields"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type AlloyDesktop,
  type RecordingLibraryMetaPatch,
} from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import { exportAndPublishCapture } from "./library-capture-publish"
import { type LibraryItemView } from "./library-data"
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
import { LocalFileLocation } from "./library-file-location"
import { LibraryMediaStage, mediaAspectRatio } from "./library-media-stage"
import { captureMentionsFromUsers, sameIdSet } from "./library-metadata"
import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

export function LibraryEditorPage({
  captureId,
  promptGame = false,
}: {
  captureId: string
  promptGame?: boolean
}) {
  const desktop = alloyDesktop()

  if (!desktop) {
    return (
      <AppMain>
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title="The library is only available in Alloy Desktop"
          description="Open Alloy in the desktop app to edit captures stored on this device."
        />
      </AppMain>
    )
  }

  return (
    <LibraryEditorContent
      desktop={desktop}
      captureId={captureId}
      promptGame={promptGame}
    />
  )
}

function LibraryEditorContent({
  desktop,
  captureId,
  promptGame,
}: {
  desktop: AlloyDesktop
  captureId: string
  promptGame: boolean
}) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const navigation = useLibraryEntryNavigation({ type: "local", id: captureId })
  const { snapshot, error, refresh, prevEntry, nextEntry } = navigation
  const [deleting, setDeleting] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  const currentEntry = navigation.currentEntry
  const item = React.useMemo(() => {
    return currentEntry?.type === "local" ? currentEntry.item : null
  }, [currentEntry])

  React.useEffect(() => {
    if (currentEntry && currentEntry.type !== "local") {
      navigateToEntry(currentEntry)
    }
  }, [currentEntry, navigateToEntry])

  const deleteCapture = async () => {
    if (deleting || !item) return
    setDeleting(true)
    // Land on the neighbor the user was heading toward, or return to the
    // library once there is no capture left to show.
    const fallback = nextEntry ?? prevEntry
    try {
      await desktop.recording.deleteLibraryCapture(item.id)
      toast.success("Capture moved to the system trash")
      void refresh()
      setDeleteDialogOpen(false)
      if (fallback) {
        navigateToEntry(fallback)
      } else {
        void navigate({ to: "/library", replace: true })
      }
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't delete capture"))
      setDeleting(false)
    }
  }

  if (error) {
    return (
      <AppMain>
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title="Couldn't scan the library"
          description={error}
        >
          <BackToLibraryButton />
        </LibraryEmpty>
      </AppMain>
    )
  }

  if (!snapshot) {
    return (
      <AppMain>
        <LoadingState className="py-16" />
      </AppMain>
    )
  }

  if (currentEntry && currentEntry.type !== "local") {
    return (
      <AppMain>
        <LoadingState className="py-16" />
      </AppMain>
    )
  }

  if (!item) {
    return (
      <AppMain>
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title="Capture not found"
          description="It may have been moved or deleted from the capture folder."
        >
          <BackToLibraryButton />
        </LibraryEmpty>
      </AppMain>
    )
  }

  return (
    <AppMain className="p-4 md:p-6">
      {/* Keyed by capture id: edits reset when navigating between captures,
          but survive background snapshot refreshes (new item identities). */}
      <EditorBody
        key={item.id}
        desktop={desktop}
        item={item}
        promptGame={promptGame}
        prevEntry={prevEntry}
        nextEntry={nextEntry}
        deleting={deleting}
        onRequestDelete={() => setDeleteDialogOpen(true)}
      />
      <DeleteLocalCaptureDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        pending={deleting}
        onConfirm={() => {
          void deleteCapture()
        }}
      />
    </AppMain>
  )
}

/**
 * Medal-style upload screen: the capture fills the space on the left with a
 * simple single-range trimmer underneath, and the metadata sheet sits on the
 * right with the upload/delete actions pinned to its bottom. Anything beyond
 * a straight trim happens in the full editor ("Open in Editor").
 */
function EditorBody({
  desktop,
  item,
  promptGame,
  prevEntry,
  nextEntry,
  deleting,
  onRequestDelete,
}: {
  desktop: AlloyDesktop
  item: LibraryItemView
  promptGame: boolean
  prevEntry: ReturnType<typeof useLibraryEntryNavigation>["prevEntry"]
  nextEntry: ReturnType<typeof useLibraryEntryNavigation>["nextEntry"]
  deleting: boolean
  onRequestDelete: () => void
}) {
  const navigate = useNavigate()
  const { publishClip } = useUploadFlowControls()

  // The trim: one kept source range plus the playhead in source time.
  const playback = useTrimPlayback({ initialDurationMs: item.durationMs ?? 0 })
  const { playerRef, trim, rangeMs } = playback

  // Draft fields are seeded from the capture's persisted metadata, then saved
  // explicitly through the same dirty-state affordance as uploaded clips.
  const [title, setTitle] = React.useState(item.title)
  const [description, setDescription] = React.useState(item.description ?? "")
  const [tags, setTags] = React.useState(item.tags ?? "")
  const [game, setGame] = React.useState<GameRow | null>(item.displayGame)
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(
    item.mentions,
  )
  const [savedMetadata, setSavedMetadata] = React.useState(() =>
    savedLocalMetadata(item),
  )
  const [saving, setSaving] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)

  // The capture's game may resolve after mount (lookup query lands once the
  // snapshot is enriched). Adopt it as long as the user hasn't picked one.
  const resolvedGame = item.displayGame
  const itemMentionKey = item.mentions.map((mention) => mention.id).join("\0")
  const itemSavedMetadata = React.useMemo(
    () => savedLocalMetadata(item),
    [
      item.description,
      item.displayGame?.id,
      item.tags,
      item.title,
      itemMentionKey,
    ],
  )
  React.useEffect(() => {
    setSavedMetadata(itemSavedMetadata)
  }, [itemSavedMetadata])

  React.useEffect(() => {
    if (!resolvedGame) return
    setGame((current) => current ?? resolvedGame)
  }, [resolvedGame])

  const isVideo = item.kind !== "screenshot"
  const poster = useCapturePoster({
    id: item.id,
    mediaUrl: isVideo ? item.mediaUrl : null,
    thumbnailUrl: item.thumbnailUrl,
    durationMs: item.durationMs,
    enabled: isVideo,
  })
  const filmstrip = useMediaFilmstrip(isVideo ? item.mediaUrl : null)
  const aspectRatio = mediaAspectRatio(item.width, item.height)
  const normalizedTitle = normalizeClipTitle(title)
  const normalizedDescription = normalizeClipDescription(description)
  const normalizedTags = parseTagString(tags)
  const mentionIds = mentions.map((mention) => mention.id)
  const titleChanged = normalizedTitle !== savedMetadata.title
  const descriptionChanged = normalizedDescription !== savedMetadata.description
  const tagsChanged = !sameIdSet(normalizedTags, savedMetadata.tags)
  const mentionsChanged = !sameIdSet(mentionIds, savedMetadata.mentionIds)
  const gameChanged = (game?.id ?? null) !== savedMetadata.gameId
  const dirty =
    titleChanged ||
    descriptionChanged ||
    tagsChanged ||
    mentionsChanged ||
    gameChanged
  const titleInvalid = normalizedTitle.length === 0
  const canPublish =
    isVideo &&
    !saving &&
    !publishing &&
    !deleting &&
    !titleInvalid &&
    rangeMs >= MIN_TRIM_MS

  useLibraryEditorShortcuts({
    prevEntry,
    nextEntry,
    onDelete: onRequestDelete,
    togglePlayback: playback.togglePlayback,
  })

  const handleSave = async () => {
    if (saving || publishing || deleting || titleInvalid || !dirty) return
    setSaving(true)
    try {
      const patch: RecordingLibraryMetaPatch = {
        id: item.id,
        ...(titleChanged ? { title: normalizedTitle } : {}),
        ...(descriptionChanged
          ? { description: normalizedDescription || null }
          : {}),
        ...(tagsChanged ? { tags: formatTags(normalizedTags) || null } : {}),
        ...(mentionsChanged
          ? { mentions: captureMentionsFromUsers(mentions) }
          : {}),
        ...(gameChanged
          ? {
              gameName: game?.name ?? null,
              gameIconUrl: game ? (game.iconUrl ?? game.logoUrl) : null,
            }
          : {}),
      }
      const result = await desktop.recording.updateLibraryCapture(patch)
      setTitle(normalizedTitle)
      setDescription(normalizedDescription)
      setTags(formatTags(normalizedTags))
      setSavedMetadata({
        title: normalizedTitle,
        description: normalizedDescription,
        tags: normalizedTags,
        mentionIds,
        gameId: game?.id ?? null,
      })
      notifyLibraryCapturesChanged()
      toast.success("Capture updated")
      if (result.id !== item.id) {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
          replace: true,
        })
      }
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't save changes"))
    } finally {
      setSaving(false)
    }
  }

  // Visibility is the publish action itself: "Post" uploads public,
  // "Create Link" uploads unlisted and puts the URL on the clipboard.
  const handlePublish = async (privacy: ClipPrivacy) => {
    const pickedGame = game
    const normalizedTitle = normalizeClipTitle(title)
    if (normalizedTitle.length === 0) return

    if (description.trim().length > CLIP_DESCRIPTION_MAX) {
      toast.error(
        `Description can be at most ${CLIP_DESCRIPTION_MAX} characters`,
      )
      return
    }

    setPublishing(true)
    try {
      const { clipId } = await exportAndPublishCapture({
        desktop,
        item,
        trim: { startMs: trim.startMs, endMs: trim.endMs },
        title: normalizedTitle,
        description,
        tags,
        game: pickedGame,
        privacy,
        mentions,
        publishClip,
      })
      if (privacy === "unlisted" && clipId && pickedGame) {
        const copied = await copyTextToClipboard(
          absoluteClipHref(pickedGame.slug, clipId, publicOrigin()),
          { action: "copy published clip link" },
        )
        if (copied) {
          toast.success("Link copied to clipboard")
        } else {
          toast.error("Couldn't copy the clip link")
        }
      } else if (privacy === "unlisted" && clipId) {
        toast.success("Clip uploaded")
      }
      void navigate({ to: "/library" })
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't prepare clip"))
    } finally {
      setPublishing(false)
    }
  }

  const primaryPublishes = !dirty
  const primaryDisabled = primaryPublishes
    ? !canPublish
    : saving || publishing || deleting || titleInvalid || !dirty
  const primaryLabel = primaryPublishes
    ? publishing
      ? "Preparing..."
      : "Post"
    : saving
      ? "Saving..."
      : "Save"
  const PrimaryIcon = primaryPublishes ? UploadIcon : SaveIcon
  const showPostInMenu = !primaryPublishes

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        {/* ── Stage: the capture, the trimmer, and the editor entry. ── */}
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          {/* The media fills the stage; on wide layouts it flexes to the
              height left over by the transport, trim bar, and editor row, so
              it grows and shrinks with the window instead of a fixed cap. */}
          <LibraryMediaStage aspectRatio={aspectRatio}>
            {isVideo ? (
              <VideoPlayer
                src={item.mediaUrl}
                sourceIdentity={item.id}
                poster={poster ?? undefined}
                posterBlurHash={item.thumbBlurHash}
                fallbackSeed={item.id}
                aspectRatio={aspectRatio}
                // Fill the stage box; the media viewport stays centered as the
                // editor area resizes.
                maxDisplayHeight="100%"
                // The player runs chrome-less: the trim bar below owns scrubbing
                // and clicking the video toggles playback.
                controls={false}
                onVideoClick={() => playback.togglePlayback()}
                playerRef={playerRef}
                onTimeUpdate={playback.handleTimeUpdate}
                onPlayingChange={playback.setPlaying}
                onEnded={playback.handleEnded}
                className="overflow-hidden rounded-md"
              />
            ) : (
              <div className="relative flex size-full items-center justify-center overflow-hidden rounded-md bg-black">
                {/* Blurred placeholder behind the media: visible until the
                  image resolves, then covered by the element. */}
                <BlurHashCanvas hash={item.thumbBlurHash} />
                <img
                  src={item.mediaUrl}
                  alt=""
                  className="relative max-h-full max-w-full object-contain"
                />
              </div>
            )}

            <LibraryEntryNavButton side="left" target={prevEntry} />
            <LibraryEntryNavButton side="right" target={nextEntry} />
          </LibraryMediaStage>

          {isVideo ? (
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
          ) : null}
        </section>

        {/* ── Sheet: metadata on top, destructive/publish actions pinned. ── */}
        <aside className="border-border bg-surface/60 flex min-w-0 flex-col gap-5 self-stretch rounded-md border p-4 lg:min-h-0 lg:overflow-y-auto">
          {!isVideo ? (
            <h1 className="text-foreground truncate text-lg font-semibold">
              {item.title}
            </h1>
          ) : null}

          {isVideo ? (
            <>
              <ClipMetadataEditor
                title={title}
                onTitleChange={setTitle}
                description={description}
                onDescriptionChange={setDescription}
                game={game}
                onGameChange={setGame}
                mentions={mentions}
                onMentionsChange={setMentions}
                tags={parseTagString(tags)}
                onTagsChange={(next) => setTags(formatTags(next))}
                disabled={saving || publishing || deleting}
                titleInvalid={titleInvalid}
                gameInvalid={false}
                autoFocusGame={promptGame}
              />
              <LocalFileLocation item={item} />
            </>
          ) : (
            <>
              {item.displayGameName ? (
                <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 text-sm">
                  <GameIcon
                    src={item.displayGameIconUrl}
                    name={item.displayGameName}
                    size="sm"
                  />
                  <span className="truncate">{item.displayGameName}</span>
                </div>
              ) : null}
              <div className="border-border bg-surface-raised/40 flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
                <ImageIcon className="text-foreground-faint size-8" />
                <p className="text-foreground-muted text-sm">
                  Screenshot upload is not available yet.
                </p>
              </div>
            </>
          )}

          <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={deleting || publishing || saving}
              onClick={onRequestDelete}
            >
              <Trash2Icon />
              Delete
            </Button>
            {isVideo ? (
              <div className="flex items-center">
                <Button
                  type="button"
                  variant="primary"
                  disabled={primaryDisabled}
                  className="h-10 rounded-r-none sm:h-8"
                  onClick={() => {
                    if (primaryPublishes) void handlePublish("public")
                    else void handleSave()
                  }}
                >
                  <PrimaryIcon />
                  {primaryLabel}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        disabled={publishing || deleting || saving}
                        aria-label="More post options"
                        className="border-l-accent-hover size-10 rounded-l-none sm:size-8"
                      />
                    }
                  >
                    <ChevronUpIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="w-52">
                    {showPostInMenu ? (
                      <DropdownMenuItem
                        disabled={!canPublish}
                        onClick={() => {
                          void handlePublish("public")
                        }}
                      >
                        <UploadIcon className="size-4" />
                        Post
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => {
                        void navigate({
                          to: "/editor",
                          search: { capture: item.id },
                        })
                      }}
                    >
                      <ClapperboardIcon className="size-4" />
                      Open in Editor
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canPublish}
                      onClick={() => {
                        void handlePublish("unlisted")
                      }}
                    >
                      <Link2Icon className="size-4" />
                      Create Link
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}

function savedLocalMetadata(item: LibraryItemView) {
  return {
    title: normalizeClipTitle(item.title),
    description: normalizeClipDescription(item.description ?? ""),
    tags: parseTagString(item.tags ?? ""),
    mentionIds: item.mentions.map((mention) => mention.id),
    gameId: item.displayGame?.id ?? null,
  }
}

function DeleteLocalCaptureDialog({
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
          <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
          <AlertDialogDescription>
            The file will be moved to your system trash.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Deleting..." : "Delete capture"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
