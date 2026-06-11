import { useNavigate } from "@tanstack/react-router"
import type { ClipPrivacy, GameRow, UserSearchResult } from "alloy-api"
import { AppMain } from "alloy-ui/components/app-shell"
import { BlurHashCanvas } from "alloy-ui/components/blurhash-canvas"
import { Button } from "alloy-ui/components/button"
import { GameIcon } from "alloy-ui/components/game-icon"
import { Kbd } from "alloy-ui/components/kbd"
import { LoadingState } from "alloy-ui/components/loading-state"
import { toast } from "alloy-ui/lib/toast"
import {
  ClapperboardIcon,
  HardDriveIcon,
  ImageIcon,
  MonitorIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import * as React from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { VideoPlayer } from "@/components/video/video-player"
import {
  CLIP_DESCRIPTION_MAX,
  formatTags,
  normalizeClipTitle,
  parseTagString,
} from "@/lib/clip-fields"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import { exportAndPublishCapture } from "./library-capture-publish"
import {
  enrichLibraryItem,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import {
  BackToLibraryButton,
  CaptureNavButton,
  TrimTransportControls,
} from "./library-editor-shared"
import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"
import { useDraftPersistence } from "./use-draft-persistence"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

export function LibraryEditorPage({ captureId }: { captureId: string }) {
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

  return <LibraryEditorContent desktop={desktop} captureId={captureId} />
}

function LibraryEditorContent({
  desktop,
  captureId,
}: {
  desktop: AlloyDesktop
  captureId: string
}) {
  const navigate = useNavigate()
  const { snapshot, error, refresh } = useLibrarySnapshot(desktop)
  const gamesByName = useLibraryGameLookup(snapshot)
  const [deleting, setDeleting] = React.useState(false)

  const item = React.useMemo(() => {
    const raw = snapshot?.items.find((entry) => entry.id === captureId)
    return raw ? enrichLibraryItem(raw, gamesByName) : null
  }, [snapshot, gamesByName, captureId])

  // Hotkey navigation walks the library in its snapshot order (newest
  // first), the same order the grid shows.
  const items = snapshot?.items ?? []
  const index = items.findIndex((entry) => entry.id === captureId)
  const prevId = index > 0 ? items[index - 1].id : null
  const nextId =
    index >= 0 && index < items.length - 1 ? items[index + 1].id : null

  const deleteCapture = async () => {
    if (deleting || !item) return
    setDeleting(true)
    // Land on the neighbor the user was heading toward; fall back to the grid.
    const fallbackId = nextId ?? prevId
    try {
      await desktop.recording.deleteLibraryCapture(item.id)
      toast.success("Capture moved to the system trash")
      void refresh()
      if (fallbackId) {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: fallbackId },
          replace: true,
        })
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
    <AppMain>
      {/* Keyed by capture id: edits reset when navigating between captures,
          but survive background snapshot refreshes (new item identities). */}
      <EditorBody
        key={item.id}
        desktop={desktop}
        item={item}
        prevId={prevId}
        nextId={nextId}
        deleting={deleting}
        onDelete={() => {
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
  prevId,
  nextId,
  deleting,
  onDelete,
}: {
  desktop: AlloyDesktop
  item: LibraryItemView
  prevId: string | null
  nextId: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const { publishClip } = useUploadFlowControls()

  // The trim: one kept source range plus the playhead in source time.
  const playback = useTrimPlayback({ initialDurationMs: item.durationMs ?? 0 })
  const { playerRef, trim, rangeMs } = playback

  // Draft fields are seeded from the capture's persisted metadata so edits
  // survive app restarts; changes flow back through updateLibraryCapture.
  const [title, setTitle] = React.useState(item.title)
  const [description, setDescription] = React.useState(item.description ?? "")
  const [tags, setTags] = React.useState(item.tags ?? "")
  const [game, setGame] = React.useState<GameRow | null>(item.displayGame)
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(
    item.mentions,
  )
  const [privacy, setPrivacy] = React.useState<ClipPrivacy>(
    item.privacy ?? "unlisted",
  )
  const [publishAttempted, setPublishAttempted] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  useDraftPersistence(desktop, item.id, {
    title,
    description,
    tags,
    mentions,
    privacy,
  })

  // The capture's game may resolve after mount (lookup query lands once the
  // snapshot is enriched). Adopt it as long as the user hasn't picked one.
  const resolvedGame = item.displayGame
  React.useEffect(() => {
    if (!resolvedGame) return
    setGame((current) => current ?? resolvedGame)
  }, [resolvedGame])

  const isVideo = item.kind !== "screenshot"
  const canPublish =
    isVideo &&
    !publishing &&
    !deleting &&
    normalizeClipTitle(title).length > 0 &&
    Boolean(game) &&
    rangeMs >= MIN_TRIM_MS

  /* ── Hotkeys: navigate between clips, delete, toggle playback ── */

  const keyActionsRef = React.useRef({
    togglePlayback: playback.togglePlayback,
    onDelete,
  })
  keyActionsRef.current = { togglePlayback: playback.togglePlayback, onDelete }
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest('[role="slider"]') ||
          target.closest('[role="dialog"]'))
      ) {
        return
      }
      if (event.key === "ArrowLeft" && prevId) {
        event.preventDefault()
        void navigate({
          to: "/library/$captureId",
          params: { captureId: prevId },
          // Replace rather than push so the browser back arrow leaves the
          // editor instead of walking capture-by-capture through history.
          replace: true,
        })
      } else if (event.key === "ArrowRight" && nextId) {
        event.preventDefault()
        void navigate({
          to: "/library/$captureId",
          params: { captureId: nextId },
          replace: true,
        })
      } else if (event.key === "Delete") {
        event.preventDefault()
        keyActionsRef.current.onDelete()
      } else if (event.key === " ") {
        event.preventDefault()
        keyActionsRef.current.togglePlayback()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [navigate, prevId, nextId])

  const handlePublish = async () => {
    setPublishAttempted(true)
    const pickedGame = game
    const normalizedTitle = normalizeClipTitle(title)
    if (!pickedGame || normalizedTitle.length === 0) return

    if (description.trim().length > CLIP_DESCRIPTION_MAX) {
      toast.error(
        `Description can be at most ${CLIP_DESCRIPTION_MAX} characters`,
      )
      return
    }

    setPublishing(true)
    try {
      await exportAndPublishCapture({
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
      void navigate({ to: "/library" })
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't prepare clip"))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 lg:items-stretch">
        {/* ── Stage: the capture, the trimmer, and the editor entry. ── */}
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          {/* The media fills the stage; on wide layouts it flexes to the
              height left over by the transport, trim bar, and editor row, so
              it grows and shrinks with the window instead of a fixed cap. */}
          <div className="relative flex aspect-video w-full items-center justify-center lg:aspect-auto lg:min-h-0 lg:flex-1">
            {isVideo ? (
              <VideoPlayer
                src={item.mediaUrl}
                sourceIdentity={item.id}
                poster={item.thumbnailUrl ?? undefined}
                posterBlurHash={item.thumbBlurHash}
                fallbackSeed={item.id}
                aspectRatio={
                  item.width && item.height
                    ? item.width / item.height
                    : undefined
                }
                // Fill the stage box; the sizing helper caps width to the
                // media ratio so the video stays centered as the box resizes.
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

            <CaptureNavButton side="left" targetId={prevId} />
            <CaptureNavButton side="right" targetId={nextId} />
          </div>

          {isVideo ? (
            <>
              <TrimTransportControls playback={playback} />

              <LibraryTrimBar
                frames={item.filmstripFrameUrls}
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

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={publishing || deleting}
                  onClick={() => {
                    void navigate({
                      to: "/editor",
                      search: { capture: item.id },
                    })
                  }}
                >
                  <ClapperboardIcon />
                  Open in Editor
                </Button>
                <p className="text-foreground-faint flex flex-1 items-center justify-center gap-1.5 text-sm">
                  Use <Kbd>←</Kbd> and <Kbd>→</Kbd> to navigate between clips.
                  <Kbd>Del</Kbd> to delete.
                </p>
              </div>
            </>
          ) : (
            <p className="text-foreground-faint flex items-center justify-center gap-1.5 text-sm">
              Use <Kbd>←</Kbd> and <Kbd>→</Kbd> to navigate between captures.
              <Kbd>Del</Kbd> to delete.
            </p>
          )}
        </section>

        {/* ── Sheet: metadata on top, destructive/publish actions pinned. ── */}
        <aside className="border-border bg-surface/60 flex min-w-0 flex-col gap-5 self-stretch rounded-md border p-4 lg:min-h-0 lg:overflow-y-auto">
          {!isVideo ? (
            <h1 className="text-foreground truncate text-lg font-semibold">
              {item.title}
            </h1>
          ) : null}

          {isVideo ? (
            <ClipMetadataEditor
              title={title}
              onTitleChange={setTitle}
              description={description}
              onDescriptionChange={setDescription}
              game={game}
              onGameChange={setGame}
              mentions={mentions}
              onMentionsChange={setMentions}
              privacy={privacy}
              onPrivacyChange={setPrivacy}
              tags={parseTagString(tags)}
              onTagsChange={(next) => setTags(formatTags(next))}
              disabled={publishing || deleting}
              titleInvalid={
                publishAttempted && normalizeClipTitle(title).length === 0
              }
              gameInvalid={publishAttempted && !game}
            />
          ) : (
            <>
              <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 text-sm">
                {item.source === "display" ? (
                  <MonitorIcon className="size-3.5" />
                ) : (
                  <GameIcon
                    src={item.displayGameIconUrl}
                    name={item.displayGameName}
                    size="sm"
                  />
                )}
                <span className="truncate">{item.displayGameName}</span>
              </div>
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
              disabled={deleting || publishing}
              onClick={onDelete}
            >
              <Trash2Icon />
              Delete
            </Button>
            {isVideo ? (
              <Button
                type="button"
                variant="primary"
                disabled={!canPublish}
                onClick={() => {
                  void handlePublish()
                }}
              >
                <UploadIcon />
                {publishing ? "Preparing..." : "Upload"}
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}
