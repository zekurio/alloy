import type { ClipPrivacy } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronUpIcon, Link2Icon, SaveIcon, UploadIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  MediaStage,
  mediaAspectRatio,
} from "@/components/clip-editor/media-stage"
import { TrimTransportControls } from "@/components/clip-editor/transport-controls"
import { TrimBar } from "@/components/clip-editor/trim-bar"
import { useClipMetadataDraft } from "@/components/clip-editor/use-clip-metadata-draft"
import {
  MIN_TRIM_MS,
  useTrimPlayback,
} from "@/components/clip-editor/use-trim-playback"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import {
  useUploadActions,
  useUploadQueue,
} from "@/components/upload/upload-flow-context"
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
  desktopSupports,
  notifyLibraryCapturesChanged,
  type AlloyDesktop,
} from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import { exportAndPublishCapture } from "./library-capture-publish"
import { type LibraryItemView } from "./library-data"
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
import {
  captureMentionsFromUsers,
  captureUsersFromMentions,
} from "./library-metadata"

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
  const { publishClip } = useUploadActions()
  const { queue } = useUploadQueue()

  const trimSupported = desktopSupports("recording.setLibraryCaptureTrim")
  const playback = useTrimPlayback({
    initialDurationMs: item.durationMs ?? 0,
    initialTrim: persistedTrim(item) ?? undefined,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const [savedTrim, setSavedTrim] = useState(() => persistedTrim(item))

  const [savedMetadata, setSavedMetadata] = useState(() =>
    savedLocalMetadata(item),
  )
  const {
    title,
    setTitle,
    description,
    setDescription,
    game,
    setGame,
    mentions,
    setMentions,
    tags,
    setTags,
    normalizedTitle,
    normalizedDescription,
    mentionIds,
    titleInvalid,
    titleChanged,
    descriptionChanged,
    gameChanged,
    mentionsChanged,
    tagsChanged,
    dirty,
  } = useClipMetadataDraft(
    {
      title: item.title,
      description: item.description ?? "",
      game: item.displayGame,
      mentions: captureUsersFromMentions(item.mentions),
      tags: parseTagString(item.tags ?? ""),
    },
    savedMetadata,
  )
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const resolvedGame = item.displayGame
  const itemMentionKey = item.mentions.map((mention) => mention.id).join("\0")
  const itemSavedMetadata = useMemo(
    () => savedLocalMetadata(item),
    [
      item.description,
      item.displayGame?.id,
      item.tags,
      item.title,
      itemMentionKey,
    ],
  )
  useEffect(() => {
    setSavedMetadata(itemSavedMetadata)
  }, [itemSavedMetadata])
  const itemSavedTrim = useMemo(
    () => persistedTrim(item),
    [item.trimStartMs, item.trimEndMs],
  )
  useEffect(() => {
    setSavedTrim(itemSavedTrim)
  }, [itemSavedTrim])

  useEffect(() => {
    if (!resolvedGame) return
    setGame((current) => current ?? resolvedGame)
  }, [resolvedGame])

  const [handoffPoster, setHandoffPoster] = useState(() =>
    readLibraryHandoffPoster(item.id),
  )
  const [localFrameReady, setLocalFrameReady] = useState(
    () => handoffPoster === null,
  )
  useEffect(() => {
    setHandoffPoster(readLibraryHandoffPoster(item.id))
  }, [item.id])
  useEffect(() => {
    setLocalFrameReady(handoffPoster === null)
  }, [handoffPoster])
  useEffect(() => {
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
  const publishLocked =
    item.uploadedClipId !== null ||
    queue.some(
      (entry) => entry.kind === "upload" && entry.localCaptureId === item.id,
    )
  const canPublish =
    !saving &&
    !publishing &&
    !deleting &&
    !publishLocked &&
    !titleInvalid &&
    rangeMs >= MIN_TRIM_MS

  useLibraryEditorShortcuts({
    prevEntry,
    nextEntry,
    onDelete: onRequestDelete,
    togglePlayback: playback.togglePlayback,
  })

  // Full-range == no trim: the persisted state for an untrimmed capture is
  // null on both bounds, matching FULL_CLIP_TOLERANCE_MS semantics.
  const currentTrim = trimmed
    ? { startMs: Math.round(trim.startMs), endMs: Math.round(trim.endMs) }
    : null
  const trimDirty =
    trimSupported &&
    playback.durationMs > 0 &&
    !sameTrimRange(currentTrim, savedTrim)

  const handleSave = async () => {
    if (saving || publishing || deleting || titleInvalid) return
    if (!dirty && !trimDirty) return
    setSaving(true)
    try {
      // Trim and metadata persist through independent bridge calls, like the
      // uploaded-clip editor. Trim saves first: a metadata save may move the
      // capture's file, retiring the id the trim call looks up.
      if (trimDirty) {
        await desktop.recording.setLibraryCaptureTrim({
          id: item.id,
          trimStartMs: currentTrim ? currentTrim.startMs : null,
          trimEndMs: currentTrim ? currentTrim.endMs : null,
        })
        setSavedTrim(currentTrim)
      }
      const result = dirty
        ? await desktop.recording.updateLibraryCapture({
            id: item.id,
            ...(titleChanged ? { title: normalizedTitle } : {}),
            ...(descriptionChanged
              ? { description: normalizedDescription || null }
              : {}),
            ...(tagsChanged ? { tags: formatTags(tags) || null } : {}),
            ...(mentionsChanged
              ? { mentions: captureMentionsFromUsers(mentions) }
              : {}),
            ...(gameChanged
              ? {
                  gameName: game?.name ?? null,
                  gameIconUrl: game ? (game.iconUrl ?? game.logoUrl) : null,
                }
              : {}),
          })
        : null
      if (result) {
        setTitle(normalizedTitle)
        setDescription(normalizedDescription)
        setSavedMetadata({
          title: normalizedTitle,
          description: normalizedDescription,
          tags,
          mentionIds,
          gameId: game?.id ?? null,
        })
      }
      notifyLibraryCapturesChanged()
      toast.success(t("Capture updated"))
      if (result && result.id !== item.id) {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
          replace: true,
        })
      }
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save changes")))
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async (privacy: ClipPrivacy) => {
    if (publishLocked) return
    const pickedGame = game
    if (normalizedTitle.length === 0) return

    if (description.trim().length > CLIP_DESCRIPTION_MAX) {
      toast.error(
        t("Description can be at most {max} characters", {
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
        trimmed,
        title: normalizedTitle,
        description,
        tags: formatTags(tags),
        game: pickedGame,
        privacy,
        mentions,
        publishClip,
        posterUrl: poster ?? item.thumbnailUrl,
      })
      if (!clipId) return
      if (privacy === "unlisted") {
        const copied = await copyTextToClipboard(
          absoluteClipHref(pickedGame?.slug ?? null, clipId, publicOrigin()),
          { action: "copy published clip link" },
        )
        if (copied) {
          toast.success(t("Link copied to clipboard"))
        } else {
          toast.error(t("Couldn't copy the clip link"))
        }
      } else {
        toast.success(t("Upload started"))
      }

      await navigate({
        to: "/library",
        replace: true,
      })
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't prepare clip")))
    } finally {
      setPublishing(false)
    }
  }

  const primaryPublishes = !dirty && !trimDirty
  const primaryDisabled = primaryPublishes
    ? !canPublish
    : saving || publishing || deleting || titleInvalid
  const primaryLabel = primaryPublishes
    ? publishLocked
      ? t("Uploading…")
      : publishing
        ? t("Preparing...")
        : t("Post")
    : saving
      ? t("Saving...")
      : t("Save")
  const PrimaryIcon = primaryPublishes ? UploadIcon : SaveIcon
  const showPostInMenu = !primaryPublishes

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <MediaStage aspectRatio={aspectRatio}>
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
          </MediaStage>

          <TrimTransportControls playback={playback} />

          <TrimBar
            frames={filmstrip.frames}
            frameAspect={filmstrip.aspect}
            durationMs={playback.durationMs}
            startMs={trim.startMs}
            endMs={trim.endMs}
            subscribeCurrentMs={playback.subscribeCurrentMs}
            getCurrentMs={playback.getCurrentMs}
            onSeek={(sourceMs) => {
              playerRef.current?.pause()
              playback.seek(sourceMs)
            }}
            onStartChange={playback.handleTrimStartChange}
            onEndChange={playback.handleTrimEndChange}
            onMove={playback.handleTrimMove}
          />
        </section>

        <Card
          tone="surface"
          role="complementary"
          className="min-w-0 gap-5 self-stretch overflow-visible p-4 lg:min-h-0 lg:overflow-y-auto"
        >
          <ClipMetadataEditor
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            game={game}
            onGameChange={setGame}
            mentions={mentions}
            onMentionsChange={setMentions}
            tags={tags}
            onTagsChange={setTags}
            disabled={saving || publishing || deleting}
            titleInvalid={titleInvalid}
            gameInvalid={false}
            autoFocusGame={promptGame}
          />
          <LocalFileLocation
            item={item}
            deleting={deleting}
            onRequestDelete={onRequestDelete}
          />

          <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={deleting || publishing || saving}
              render={<Link to="/library" />}
            >
              {t("Cancel")}
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
                      aria-label={t("More post options")}
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
                      {t("Post")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={!canPublish}
                    onClick={() => {
                      void handlePublish("unlisted")
                    }}
                  >
                    <Link2Icon className="size-4" />
                    {t("Create Link")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </Card>
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

/**
 * The trim persisted on the capture, or null when untrimmed. The typeof
 * checks also cover shells older than the trim fields, where both are
 * undefined at runtime.
 */
function persistedTrim(item: LibraryItemView) {
  return typeof item.trimStartMs === "number" &&
    typeof item.trimEndMs === "number"
    ? { startMs: item.trimStartMs, endMs: item.trimEndMs }
    : null
}

function sameTrimRange(
  a: { startMs: number; endMs: number } | null,
  b: { startMs: number; endMs: number } | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.startMs === b.startMs && a.endMs === b.endMs
}
