import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronUpIcon,
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
  notifyLibraryCapturesChanged,
  type AlloyDesktop,
  type RecordingLibraryMetaPatch,
} from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import { exportAndPublishCapture } from "./library-capture-publish"
import { type LibraryItemView } from "./library-data"
import { TrimTransportControls } from "./library-editor-shared"
import {
  LibraryEntryNavButton,
  type NavigableLibraryEntry,
  useLibraryEditorShortcuts,
} from "./library-entry-navigation"
import { LocalFileLocation } from "./library-file-location"
import {
  clearLibraryHandoffPoster,
  LibraryHandoffPosterOverlay,
  readLibraryHandoffPoster,
} from "./library-handoff-poster"
import { LibraryMediaStage, mediaAspectRatio } from "./library-media-stage"
import { captureMentionsFromUsers, sameIdSet } from "./library-metadata"
import { LibraryTrimBar } from "./library-trim-bar"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

/**
 * Medal-style publish screen: the capture fills the space on the left with a
 * simple single-range trimmer underneath, and the metadata sheet sits on the
 * right with the post/delete actions pinned to its bottom.
 */
export function EditorBody({
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
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  deleting: boolean
  onRequestDelete: () => void
}) {
  const navigate = useNavigate()
  const { publishClip } = useUploadFlowControls()

  const playback = useTrimPlayback({ initialDurationMs: item.durationMs ?? 0 })
  const { playerRef, trim, rangeMs } = playback

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

  const [handoffPoster, setHandoffPoster] = React.useState(() =>
    readLibraryHandoffPoster(item.id),
  )
  const [localFrameReady, setLocalFrameReady] = React.useState(
    () => handoffPoster === null,
  )
  React.useEffect(() => {
    setHandoffPoster(readLibraryHandoffPoster(item.id))
  }, [item.id])
  React.useEffect(() => {
    setLocalFrameReady(handoffPoster === null)
  }, [handoffPoster])
  React.useEffect(() => {
    if (handoffPoster && localFrameReady) clearLibraryHandoffPoster(item.id)
  }, [handoffPoster, item.id, localFrameReady])
  const poster = useCapturePoster({
    id: item.id,
    mediaUrl: item.mediaUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationMs: item.durationMs,
    enabled: true,
  })
  const filmstrip = useMediaFilmstrip(item.mediaUrl)
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
      toast.success(tx("Capture updated"))
      if (result.id !== item.id) {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
          replace: true,
        })
      }
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't save changes")))
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async (privacy: ClipPrivacy) => {
    const pickedGame = game
    const normalizedTitle = normalizeClipTitle(title)
    if (normalizedTitle.length === 0) return

    if (description.trim().length > CLIP_DESCRIPTION_MAX) {
      toast.error(
        tx("Description can be at most {max} characters", {
          max: CLIP_DESCRIPTION_MAX,
        }),
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
        posterUrl: poster ?? item.thumbnailUrl,
      })
      if (!clipId) return
      if (privacy === "unlisted" && pickedGame) {
        const copied = await copyTextToClipboard(
          absoluteClipHref(pickedGame.steamgriddbId, clipId, publicOrigin()),
          { action: "copy published clip link" },
        )
        if (copied) {
          toast.success(tx("Link copied to clipboard"))
        } else {
          toast.error(tx("Couldn't copy the clip link"))
        }
      } else {
        toast.success(tx("Upload started"))
      }

      await navigate({
        to: "/library",
        replace: true,
      })
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't prepare clip")))
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
      ? tx("Preparing...")
      : tx("Post")
    : saving
      ? tx("Saving...")
      : tx("Save")
  const PrimaryIcon = primaryPublishes ? UploadIcon : SaveIcon
  const showPostInMenu = !primaryPublishes

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <LibraryMediaStage aspectRatio={aspectRatio}>
            <VideoPlayer
              src={item.mediaUrl}
              sourceIdentity={item.id}
              poster={poster ?? undefined}
              posterBlurHash={item.thumbBlurHash}
              fallbackSeed={item.id}
              aspectRatio={aspectRatio}
              maxDisplayHeight="100%"
              controls={false}
              onVideoClick={() => playback.togglePlayback()}
              playerRef={playerRef}
              onTimeUpdate={playback.handleTimeUpdate}
              onPlayingChange={playback.setPlaying}
              onFrameReady={() => setLocalFrameReady(true)}
              onEnded={playback.handleEnded}
              className="overflow-hidden rounded-md"
            />

            <LibraryEntryNavButton side="left" target={prevEntry} />
            <LibraryEntryNavButton side="right" target={nextEntry} />
            <LibraryHandoffPosterOverlay
              poster={handoffPoster}
              ready={localFrameReady}
            />
          </LibraryMediaStage>

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
        </section>

        <aside className="border-border bg-surface/60 flex min-w-0 flex-col gap-5 self-stretch rounded-md border p-4 lg:min-h-0 lg:overflow-y-auto">
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

          <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={deleting || publishing || saving}
              render={<Link to="/library" />}
            >
              {tx("Cancel")}
            </Button>
            <div className="flex items-center">
              <Button
                type="button"
                variant="primary"
                disabled={primaryDisabled}
                className="rounded-r-none"
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
                      aria-label={tx("More post options")}
                      className="border-l-accent-hover size-9 rounded-l-none sm:size-8"
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
                      {tx("Post")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={!canPublish}
                    onClick={() => {
                      void handlePublish("unlisted")
                    }}
                  >
                    <Link2Icon className="size-4" />
                    {tx("Create Link")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={deleting || publishing || saving}
                    onClick={onRequestDelete}
                  >
                    <Trash2Icon className="size-4" />
                    {tx("Delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
