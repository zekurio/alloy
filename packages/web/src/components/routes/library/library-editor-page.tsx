import { Link, useNavigate } from "@tanstack/react-router"
import type {
  AcceptedContentType,
  ClipPrivacy,
  GameRow,
  UserSearchResult,
} from "alloy-api"
import { AppMain } from "alloy-ui/components/app-shell"
import { BlurHashCanvas } from "alloy-ui/components/blurhash-canvas"
import { Button } from "alloy-ui/components/button"
import { GameIcon } from "alloy-ui/components/game-icon"
import { Kbd } from "alloy-ui/components/kbd"
import { Spinner } from "alloy-ui/components/spinner"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  HardDriveIcon,
  ImageIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import * as React from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import {
  captureThumbnail,
  prepareSelectedClipFile,
} from "@/components/upload/new-clip-helpers"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { VideoPlayer } from "@/components/video/video-player"
import type { VideoPlayerHandle } from "@/components/video/video-player-types"
import {
  CLIP_DESCRIPTION_MAX,
  formatTags,
  normalizeClipTitle,
  nullableClipDescription,
  parseTagString,
} from "@/lib/clip-fields"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { formatTrimMs } from "@/lib/media-time"

import {
  enrichLibraryItem,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"

const MIN_TRIM_MS = 1000
/** Tolerance when deciding whether the trim still covers the full clip. */
const FULL_CLIP_TOLERANCE_MS = 50
const ACCEPTED_EXPORT_TYPES = new Set<AcceptedContentType>([
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
])

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
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
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

function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      Back to library
    </Button>
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
  const playerRef = React.useRef<VideoPlayerHandle | null>(null)
  const { publishClip } = useUploadFlowControls()
  const [playing, setPlaying] = React.useState(false)
  const [durationMs, setDurationMs] = React.useState(item.durationMs ?? 0)

  // The trim: one kept source range plus the playhead in source time.
  const [trim, setTrim] = React.useState({
    startMs: 0,
    endMs: item.durationMs ?? 0,
  })
  const [currentMs, setCurrentMs] = React.useState(0)
  const trimRef = React.useRef(trim)
  trimRef.current = trim

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
  const rangeMs = Math.max(0, trim.endMs - trim.startMs)
  const trimmed =
    durationMs > 0 &&
    (trim.startMs > FULL_CLIP_TOLERANCE_MS ||
      trim.endMs < durationMs - FULL_CLIP_TOLERANCE_MS)
  const elapsedMs = Math.min(rangeMs, Math.max(0, currentMs - trim.startMs))
  const canPublish =
    isVideo &&
    !publishing &&
    !deleting &&
    normalizeClipTitle(title).length > 0 &&
    Boolean(game) &&
    rangeMs >= MIN_TRIM_MS

  /* ── Playback over the trimmed range ── */

  // While playing, an animation-frame loop follows the player and loops
  // playback back to the trim start when it runs past the trim end.
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const player = playerRef.current
      if (player) {
        const sourceMs = player.getCurrentTime() * 1000
        const { startMs, endMs } = trimRef.current
        if (endMs > startMs && sourceMs >= endMs - 10) {
          player.seek(startMs / 1000)
          setCurrentMs(startMs)
        } else {
          setCurrentMs(sourceMs)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const handleTimeUpdate = () => {
    // The player reports the real duration once metadata lands; adopt it and
    // re-fit the trim into the actual media bounds.
    const reported = Math.round((playerRef.current?.getDuration() ?? 0) * 1000)
    if (reported > 0 && reported !== durationMs) {
      setDurationMs(reported)
      setTrim((current) => ({
        startMs: Math.min(current.startMs, Math.max(0, reported - MIN_TRIM_MS)),
        // An untouched full-range trim simply adopts the new duration.
        endMs:
          current.endMs <= 0 ||
          current.endMs >= durationMs - FULL_CLIP_TOLERANCE_MS
            ? reported
            : Math.min(current.endMs, reported),
      }))
    }
  }

  const seek = (sourceMs: number) => {
    const clamped = Math.min(Math.max(0, sourceMs), durationMs || sourceMs)
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000)
  }

  const togglePlayback = () => {
    const player = playerRef.current
    if (!player) return
    if (playing) {
      player.pause()
      return
    }
    // Restart from the trim start once the range has fully played, and pull
    // a playhead parked before the range into it.
    let target = currentMs
    if (target >= trim.endMs - 10 || target < trim.startMs) {
      target = trim.startMs
      setCurrentMs(target)
    }
    if (Math.abs(player.getCurrentTime() * 1000 - target) > 80) {
      player.seek(target / 1000)
    }
    void player.play()
  }

  const stopPlayback = () => {
    const player = playerRef.current
    if (!player) return
    player.pause()
    // Seek without resuming: the player still reports "playing" until the
    // pause event lands, so a plain seek would restart playback.
    setCurrentMs(trim.startMs)
    player.seek(trim.startMs / 1000, false)
  }

  const handleEnded = () => {
    // Loop the preview like the in-range wraparound does.
    seek(trim.startMs)
    void playerRef.current?.play()
  }

  // Trim handles update live while dragging: the edge follows the pointer
  // and the (paused) player scrubs to the cut frame.
  const handleTrimStartChange = (sourceMs: number) => {
    const clamped = Math.round(
      Math.min(Math.max(0, sourceMs), trim.endMs - MIN_TRIM_MS),
    )
    setTrim((current) => ({ ...current, startMs: clamped }))
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000)
  }

  const handleTrimEndChange = (sourceMs: number) => {
    const clamped = Math.round(
      Math.max(Math.min(durationMs, sourceMs), trim.startMs + MIN_TRIM_MS),
    )
    setTrim((current) => ({ ...current, endMs: clamped }))
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000)
  }

  const resetTrim = () => {
    setTrim({ startMs: 0, endMs: durationMs })
  }

  /* ── Hotkeys: navigate between clips, delete, toggle playback ── */

  const keyActionsRef = React.useRef({ togglePlayback, onDelete })
  keyActionsRef.current = { togglePlayback, onDelete }
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
      const exported = await desktop.recording.exportLibraryCapture({
        id: item.id,
        segments: [{ startMs: trim.startMs, endMs: trim.endMs }],
      })
      const response = await fetch(exported.mediaUrl)
      if (!response.ok) throw new Error("Could not read exported clip.")
      const blob = await response.blob()
      const contentType = acceptedContentType(exported.contentType)
      const file = new File([blob], exported.fileName, {
        type: contentType,
        lastModified: Date.now(),
      })
      const selected = await prepareSelectedClipFile(file)
      const posterAtMs = Math.min(1000, Math.max(0, selected.durationMs - 100))
      const thumbBlob = await captureThumbnail(selected.file, posterAtMs)

      await publishClip({
        file: selected.file,
        contentType: selected.contentType,
        title: normalizedTitle,
        description: nullableClipDescription(description),
        tags: parseTagString(tags),
        steamgriddbId: pickedGame.steamgriddbId,
        privacy,
        width: selected.width,
        height: selected.height,
        durationMs: selected.durationMs,
        sizeBytes: selected.sizeBytes,
        thumbBlob,
        thumbBlurHash: exported.thumbBlurHash ?? item.thumbBlurHash,
        mentionedUserIds: mentions.map((mention) => mention.id),
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
                onVideoClick={() => togglePlayback()}
                playerRef={playerRef}
                onTimeUpdate={handleTimeUpdate}
                onPlayingChange={setPlaying}
                onEnded={handleEnded}
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
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label={playing ? "Pause (Space)" : "Play (Space)"}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                    onClick={togglePlayback}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stop"
                    title="Stop"
                    onClick={stopPlayback}
                  >
                    <SquareIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reset trim"
                    title="Reset trim"
                    onClick={resetTrim}
                    disabled={!trimmed}
                    className={cn(
                      "text-foreground-faint hover:text-foreground transition-opacity",
                      !trimmed && "pointer-events-none opacity-0",
                    )}
                  >
                    <RotateCcwIcon />
                  </Button>
                </div>
                <span className="text-foreground-muted text-sm tabular-nums">
                  {formatTrimMs(elapsedMs)} / {formatTrimMs(rangeMs)}
                </span>
                {trimmed ? (
                  <span className="text-foreground-faint text-sm tabular-nums">
                    Trimmed to {formatTrimMs(trim.startMs)} –{" "}
                    {formatTrimMs(trim.endMs)}
                  </span>
                ) : null}
              </div>

              <LibraryTrimBar
                frames={item.filmstripFrameUrls}
                durationMs={durationMs}
                startMs={trim.startMs}
                endMs={trim.endMs}
                currentMs={currentMs}
                onSeek={(sourceMs) => {
                  playerRef.current?.pause()
                  seek(sourceMs)
                }}
                onStartChange={handleTrimStartChange}
                onEndChange={handleTrimEndChange}
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

/** Floating edge button mirroring the ←/→ hotkeys. */
function CaptureNavButton({
  side,
  targetId,
}: {
  side: "left" | "right"
  targetId: string | null
}) {
  if (!targetId) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={side === "left" ? "Previous capture (←)" : "Next capture (→)"}
      title={side === "left" ? "Previous capture (←)" : "Next capture (→)"}
      className={cn(
        "absolute top-1/2 z-40 h-12 w-12 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
        side === "left" ? "left-2" : "right-2",
      )}
      render={
        <Link
          to="/library/$captureId"
          params={{ captureId: targetId }}
          // Replace history so the back arrow exits the editor rather than
          // stepping back through previously viewed captures.
          replace
        />
      }
    >
      {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </Button>
  )
}

/**
 * Saves the editor's draft metadata to the desktop capture store, debounced,
 * so titles, descriptions, tags, mentions, and visibility survive app
 * restarts. The initial render is skipped — only actual edits write.
 */
function useDraftPersistence(
  desktop: AlloyDesktop,
  captureId: string,
  draft: {
    title: string
    description: string
    tags: string
    mentions: UserSearchResult[]
    privacy: ClipPrivacy
  },
) {
  const firstRunRef = React.useRef(true)
  const { title, description, tags, mentions, privacy } = draft

  React.useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    const handle = window.setTimeout(() => {
      desktop.recording
        .updateLibraryCapture({
          id: captureId,
          title: normalizeClipTitle(title) || undefined,
          description: description || null,
          tags: tags || null,
          mentions: mentions.map((mention) => ({
            id: mention.id,
            username: mention.username,
            displayUsername: mention.displayUsername,
            name: mention.displayUsername || mention.username,
            image: mention.image,
          })),
          privacy,
        })
        .catch(() => {
          // Draft persistence is best effort; the in-memory state is intact.
        })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [desktop, captureId, title, description, tags, mentions, privacy])
}

function acceptedContentType(value: string): AcceptedContentType {
  if (ACCEPTED_EXPORT_TYPES.has(value as AcceptedContentType)) {
    return value as AcceptedContentType
  }
  throw new Error("Exported clip type is not supported for upload.")
}
