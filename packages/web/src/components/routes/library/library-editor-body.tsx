import type { ClipPrivacy } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Card } from "@alloy/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronUpIcon,
  CircleAlertIcon,
  CopyIcon,
  Link2Icon,
  SaveIcon,
  UploadIcon,
} from "lucide-react"
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
  sameTrimRange,
  toPersistedTrimRange,
  useTrimPlayback,
} from "@/components/clip-editor/use-trim-playback"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import {
  stripExtension,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import {
  useUploadActions,
  useUploadQueue,
} from "@/components/upload/upload-flow-context"
import type {
  WebUploadAction,
  WebUploadMetadata,
} from "@/components/upload/web-upload-action"
import {
  useExternalVideoVolume,
  VideoPlayer,
} from "@/components/video/video-player"
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
import { notifyLibraryCapturesChanged, type AlloyDesktop } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { useMediaWaveform } from "@/lib/media-waveform"
import { useActionFeedback } from "@/lib/use-action-feedback"

import { exportAndPublishCapture } from "./library-capture-publish"
import { EditorVolumeControl } from "./library-clip-editor-media"
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
  usersFromCaptureMentions,
} from "./library-metadata"

/**
 * Medal-style publish screen: the capture fills the space on the left with a
 * simple single-range trimmer underneath, and the metadata sheet sits on the
 * right with the post/delete actions pinned to its bottom.
 */
type LocalEditorBodyProps = {
  desktop: AlloyDesktop
  item: LibraryItemView
  promptGame: boolean
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  deleting: boolean
  onRequestDelete: () => void
}

type UploadEditorBodyProps = {
  uploadAction: WebUploadAction
  selected: SelectedFile
  previewUrl: string
}

export function EditorBody(
  props: LocalEditorBodyProps | UploadEditorBodyProps,
) {
  if ("uploadAction" in props) return <UploadEditorBody {...props} />
  return <LocalEditorBody {...props} />
}

function LocalEditorBody({
  desktop,
  item,
  promptGame,
  prevEntry,
  nextEntry,
  deleting,
  onRequestDelete,
}: LocalEditorBodyProps) {
  const navigate = useNavigate()
  const { publishClip } = useUploadActions()
  const { queue } = useUploadQueue()

  const playback = useTrimPlayback({
    initialDurationMs: item.durationMs ?? 0,
    initialTrim: persistedTrim(item) ?? undefined,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const playerVolume = useExternalVideoVolume(playerRef)
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
      mentions: usersFromCaptureMentions(item.mentions),
      tags: parseTagString(item.tags ?? ""),
    },
    savedMetadata,
  )
  const saveFeedback = useActionFeedback()
  const publishFeedback = useActionFeedback()
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null)
  const saving = saveFeedback.feedback.state === "pending"
  const publishing = publishFeedback.feedback.state === "pending"

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
  const waveform = useMediaWaveform(
    item.mediaUrl,
    `desktop:${item.id}:${item.modifiedAt}:${item.sizeBytes}:${item.mediaUrl}`,
    item.durationMs ?? 0,
  )
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
  const currentTrim = toPersistedTrimRange(trim, trimmed)
  const trimDirty =
    playback.durationMs > 0 && !sameTrimRange(currentTrim, savedTrim)

  const handleSave = () => {
    if (saving || publishing || deleting || titleInvalid) return
    if (!dirty && !trimDirty) return
    void saveFeedback.run(async () => {
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
      const patch: Parameters<
        typeof desktop.recording.updateLibraryCapture
      >[0] = { id: item.id }
      if (titleChanged) patch.title = normalizedTitle
      if (descriptionChanged) {
        patch.description = normalizedDescription || null
      }
      if (tagsChanged) patch.tags = formatTags(tags) || null
      if (mentionsChanged) {
        patch.mentions = captureMentionsFromUsers(mentions)
      }
      if (gameChanged) {
        patch.gameName = game?.name ?? null
        patch.gameIconUrl = game ? (game.iconUrl ?? game.logoUrl) : null
      }
      const result = dirty
        ? await desktop.recording.updateLibraryCapture(patch)
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
      if (result && result.id !== item.id) {
        await navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
          replace: true,
        })
      }
    }, t("Couldn't save changes"))
  }

  const handlePublish = (privacy: ClipPrivacy) => {
    if (publishLocked || linkToCopy) return
    const pickedGame = game
    if (normalizedTitle.length === 0) return
    void publishFeedback.run(async () => {
      if (description.trim().length > CLIP_DESCRIPTION_MAX) {
        throw new Error(
          t("Description can be at most {max} characters", {
            max: CLIP_DESCRIPTION_MAX,
          }),
        )
      }
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
        const link = absoluteClipHref(
          pickedGame?.slug ?? null,
          clipId,
          publicOrigin(),
        )
        if (!(await copyPublishedClipLink(link))) {
          setLinkToCopy(link)
          throw new Error(
            t("Upload started, but the clip link couldn't be copied."),
          )
        }
      }

      await navigate({
        to: "/library",
        replace: true,
      })
    }, t("Couldn't prepare clip"))
  }

  const handleLinkCopy = () => {
    if (!linkToCopy) return
    void publishFeedback.run(async () => {
      if (!(await copyPublishedClipLink(linkToCopy))) {
        throw new Error(
          t("Upload started, but the clip link couldn't be copied."),
        )
      }
      setLinkToCopy(null)
      await navigate({ to: "/library", replace: true })
    }, t("Couldn't copy the clip link"))
  }

  const awaitingLinkCopy = linkToCopy !== null
  const primaryPublishes = !dirty && !trimDirty
  const primaryDisabled = awaitingLinkCopy
    ? publishing || deleting
    : primaryPublishes
      ? !canPublish
      : saving || publishing || deleting || titleInvalid
  const primaryLabel = awaitingLinkCopy
    ? publishing
      ? t("Copying…")
      : t("Copy link")
    : primaryPublishes
      ? publishLocked
        ? t("Uploading…")
        : publishing
          ? t("Preparing...")
          : t("Post")
      : saving
        ? t("Saving...")
        : t("Save")
  const PrimaryIcon = awaitingLinkCopy
    ? CopyIcon
    : primaryPublishes
      ? UploadIcon
      : SaveIcon
  const showPostInMenu = !awaitingLinkCopy && !primaryPublishes
  const primaryFeedback =
    awaitingLinkCopy || primaryPublishes
      ? publishFeedback.feedback
      : saveFeedback.feedback
  const actionError =
    saveFeedback.feedback.state === "error"
      ? saveFeedback.feedback.message
      : publishFeedback.feedback.state === "error"
        ? publishFeedback.feedback.message
        : null

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
            />

            <LibraryEntryNavButton side="left" target={prevEntry} />
            <LibraryEntryNavButton side="right" target={nextEntry} />
            <LibraryHandoffPosterOverlay
              poster={handoffPoster}
              ready={localFrameReady}
            />
          </MediaStage>

          <TrimTransportControls
            playback={playback}
            trailing={<EditorVolumeControl playerVolume={playerVolume} />}
          />

          <TrimBar
            waveform={waveform}
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
            disabled={saving || publishing || deleting || awaitingLinkCopy}
            titleInvalid={titleInvalid}
            gameInvalid={false}
            autoFocusGame={promptGame}
          />
          <LocalFileLocation
            item={item}
            deleting={deleting}
            onRequestDelete={onRequestDelete}
          />

          {actionError ? (
            <Callout tone="destructive" className="text-xs">
              <CircleAlertIcon />
              <span>{actionError}</span>
            </Callout>
          ) : null}

          <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={deleting || publishing || saving}
              render={<Link to="/library" />}
            >
              {awaitingLinkCopy ? t("Done") : t("Cancel")}
            </Button>
            {awaitingLinkCopy ? (
              <FeedbackButton
                type="button"
                variant="primary"
                disabled={primaryDisabled}
                state={primaryFeedback.state}
                pendingLabel={primaryLabel}
                successLabel={t("Copied")}
                errorLabel={t("Try again")}
                onClick={handleLinkCopy}
              >
                <PrimaryIcon />
                {primaryLabel}
              </FeedbackButton>
            ) : (
              <div className="flex items-center">
                <FeedbackButton
                  type="button"
                  variant="primary"
                  disabled={primaryDisabled}
                  state={primaryFeedback.state}
                  pendingLabel={primaryLabel}
                  successLabel={primaryPublishes ? t("Started") : t("Saved")}
                  errorLabel={t("Try again")}
                  className="rounded-r-none"
                  onClick={() => {
                    if (primaryPublishes) handlePublish("public")
                    else handleSave()
                  }}
                >
                  <PrimaryIcon />
                  {primaryLabel}
                </FeedbackButton>
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
                          handlePublish("public")
                        }}
                      >
                        <UploadIcon className="size-4" />
                        {t("Post")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      disabled={!canPublish}
                      onClick={() => {
                        handlePublish("unlisted")
                      }}
                    >
                      <Link2Icon className="size-4" />
                      {t("Create Link")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </Card>
      </div>
    </section>
  )
}

function UploadEditorBody({
  uploadAction,
  selected,
  previewUrl,
}: UploadEditorBodyProps) {
  const playback = useTrimPlayback({ initialDurationMs: selected.durationMs })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const waveform = useMediaWaveform(
    previewUrl,
    `upload:${previewUrl}`,
    selected.durationMs,
  )
  const aspectRatio = mediaAspectRatio(selected.width, selected.height)
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
    titleInvalid,
    descriptionInvalid,
  } = useClipMetadataDraft({
    title: stripExtension(selected.name),
    description: "",
    game: null,
    mentions: [],
    tags: [],
  })
  const canPublish =
    !uploadAction.publishing &&
    !uploadAction.awaitingLinkCopy &&
    !titleInvalid &&
    !descriptionInvalid &&
    rangeMs >= MIN_TRIM_MS

  const publish = (privacy: ClipPrivacy) => {
    if (!canPublish) return
    const metadata: WebUploadMetadata = {
      title: normalizedTitle,
      description: normalizedDescription,
      tags: formatTags(tags),
      game,
      privacy,
      mentions,
      trim: { startMs: trim.startMs, endMs: trim.endMs },
      trimmed,
    }
    void uploadAction.publish(metadata)
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          <MediaStage aspectRatio={aspectRatio}>
            <VideoPlayer
              src={previewUrl}
              sourceIdentity={previewUrl}
              fallbackSeed={selected.name}
              aspectRatio={aspectRatio}
              maxDisplayHeight="100%"
              controls={false}
              onVideoClick={() => playback.togglePlayback()}
              playerRef={playerRef}
              onTimeUpdate={playback.handleTimeUpdate}
              onPlayingChange={playback.setPlaying}
              onEnded={playback.handleEnded}
            />
          </MediaStage>

          <TrimTransportControls playback={playback} />

          <TrimBar
            waveform={waveform}
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
            disabled={uploadAction.publishing || uploadAction.awaitingLinkCopy}
            titleInvalid={titleInvalid}
            gameInvalid={false}
          />
          {descriptionInvalid ? (
            <p className="text-destructive text-xs">
              {t("Description can be at most {max} characters", {
                max: CLIP_DESCRIPTION_MAX,
              })}
            </p>
          ) : null}
          {uploadAction.error ? (
            <Callout tone="destructive" className="text-xs">
              <CircleAlertIcon />
              <span>{uploadAction.error}</span>
            </Callout>
          ) : null}

          <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={uploadAction.publishing}
              onClick={uploadAction.discard}
            >
              {uploadAction.awaitingLinkCopy ? t("Done") : t("Cancel")}
            </Button>
            {uploadAction.awaitingLinkCopy ? (
              <FeedbackButton
                type="button"
                variant="primary"
                state={
                  uploadAction.publishing
                    ? "pending"
                    : uploadAction.error
                      ? "error"
                      : "idle"
                }
                pendingLabel={t("Copying…")}
                errorLabel={t("Try again")}
                onClick={() => {
                  void uploadAction.retryLinkCopy()
                }}
              >
                <CopyIcon />
                {t("Copy link")}
              </FeedbackButton>
            ) : (
              <div className="flex items-center">
                <FeedbackButton
                  type="button"
                  variant="primary"
                  disabled={!canPublish}
                  state={
                    uploadAction.publishing
                      ? "pending"
                      : uploadAction.error
                        ? "error"
                        : "idle"
                  }
                  pendingLabel={t("Uploading...")}
                  errorLabel={t("Try again")}
                  className="rounded-r-none"
                  onClick={() => publish("public")}
                >
                  <UploadIcon />
                  {t("Post")}
                </FeedbackButton>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        disabled={!canPublish}
                        aria-label={t("More post options")}
                        className="border-l-accent-hover size-9 rounded-l-none sm:size-8"
                      />
                    }
                  >
                    <ChevronUpIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="w-52">
                    <DropdownMenuItem onClick={() => publish("unlisted")}>
                      <Link2Icon className="size-4" />
                      {t("Create Link")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </Card>
      </div>
    </section>
  )
}

async function copyPublishedClipLink(link: string) {
  return copyTextToClipboard(link, { action: "copy published clip link" })
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
 * The trim persisted on the capture, or null when untrimmed or malformed.
 * Number.isFinite rejects stale bridge values without coercing strings.
 */
function persistedTrim(item: LibraryItemView) {
  const startMs = finiteTrimMs(item.trimStartMs)
  const endMs = finiteTrimMs(item.trimEndMs)
  return startMs !== null && endMs !== null ? { startMs, endMs } : null
}

function finiteTrimMs(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Number(value) : null
}
