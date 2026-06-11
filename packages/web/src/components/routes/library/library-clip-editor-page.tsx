import { Link, useNavigate } from "@tanstack/react-router"
import {
  type ClipMentionRef,
  type ClipPrivacy,
  type ClipRow,
  clipStreamUrl,
  clipThumbnailUrl,
  type GameRow,
  type UserSearchResult,
} from "alloy-api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "alloy-ui/components/alert-dialog"
import { AppMain } from "alloy-ui/components/app-shell"
import { Button } from "alloy-ui/components/button"
import { Progress } from "alloy-ui/components/progress"
import { Spinner } from "alloy-ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "alloy-ui/components/tabs"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import {
  ArrowLeftIcon,
  ClapperboardIcon,
  CloudIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  ScissorsIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { ClipComments } from "@/components/clip/clip-comments"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { VideoPlayer } from "@/components/video/video-player"
import type { VideoPlayerHandle } from "@/components/video/video-player-types"
import { useSession } from "@/lib/auth-client"
import { normalizeClipDescription, normalizeClipTitle } from "@/lib/clip-fields"
import {
  useClipQuery,
  useDeleteClipMutation,
  useTrimClipMutation,
  useUpdateClipMutation,
} from "@/lib/clip-queries"
import { alloyDesktop } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { browserLiveCodecs } from "@/lib/live-codecs"
import { formatTrimMs } from "@/lib/media-time"

import { LibraryEmpty } from "./library-page"
import { LibraryTrimBar } from "./library-trim-bar"

const MIN_TRIM_MS = 1000
/** Tolerance when deciding whether the trim still covers the full clip. */
const FULL_CLIP_TOLERANCE_MS = 50

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
          <div className="flex items-center justify-center py-16">
            <Spinner className="size-6" />
          </div>
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

function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      Back to library
    </Button>
  )
}

function ClipEditorBody({ row }: { row: ClipRow }) {
  const navigate = useNavigate()
  const desktop = alloyDesktop()
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const canManage =
    viewerId !== null && (viewerId === row.authorId || viewerRole === "admin")
  const isOwner = viewerId !== null && viewerId === row.authorId

  const processing = row.status !== "ready" || row.encodeProgress < 100
  const playerRef = React.useRef<VideoPlayerHandle | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [durationMs, setDurationMs] = React.useState(row.durationMs ?? 0)
  const [trim, setTrim] = React.useState({
    startMs: 0,
    endMs: row.durationMs ?? 0,
  })
  const [currentMs, setCurrentMs] = React.useState(0)
  const trimRef = React.useRef(trim)
  trimRef.current = trim

  const trimMutation = useTrimClipMutation()
  const deleteMutation = useDeleteClipMutation()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  const liveCodecs = React.useMemo(() => browserLiveCodecs(), [])
  // Versioned by updatedAt so a finished server trim busts the media cache
  // and the player reloads the newly cut source.
  const streamSrc = `${clipStreamUrl(row.id, "source", apiOrigin(), liveCodecs)}&v=${encodeURIComponent(row.updatedAt)}`
  const poster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : undefined

  const rangeMs = Math.max(0, trim.endMs - trim.startMs)
  const trimmed =
    durationMs > 0 &&
    (trim.startMs > FULL_CLIP_TOLERANCE_MS ||
      trim.endMs < durationMs - FULL_CLIP_TOLERANCE_MS)
  const elapsedMs = Math.min(rangeMs, Math.max(0, currentMs - trim.startMs))
  const canTrim = isOwner && !processing
  const canSaveTrim =
    canTrim && trimmed && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending

  /* ── Playback over the trimmed range (mirrors the capture editor) ── */

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
    const reported = Math.round((playerRef.current?.getDuration() ?? 0) * 1000)
    if (reported > 0 && reported !== durationMs) {
      setDurationMs(reported)
      setTrim((current) => ({
        startMs: Math.min(current.startMs, Math.max(0, reported - MIN_TRIM_MS)),
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
    setCurrentMs(trim.startMs)
    player.seek(trim.startMs / 1000, false)
  }

  const handleEnded = () => {
    seek(trim.startMs)
    void playerRef.current?.play()
  }

  const handleTrimStartChange = (sourceMs: number) => {
    if (!canTrim) return
    const clamped = Math.round(
      Math.min(Math.max(0, sourceMs), trim.endMs - MIN_TRIM_MS),
    )
    setTrim((current) => ({ ...current, startMs: clamped }))
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000)
  }

  const handleTrimEndChange = (sourceMs: number) => {
    if (!canTrim) return
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

  /* ── Space toggles playback, like the capture editor ── */

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
          setTrim({ startMs: 0, endMs: 0 })
          setCurrentMs(0)
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
              onVideoClick={() => togglePlayback()}
              playerRef={playerRef}
              onTimeUpdate={handleTimeUpdate}
              onPlayingChange={setPlaying}
              onEnded={handleEnded}
              className="overflow-hidden rounded-md"
            />
          </div>

          {processing ? (
            <div className="border-border bg-surface/60 flex items-center gap-3 rounded-md border p-3">
              <Spinner className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">
                  Processing clip...
                </p>
                <Progress
                  value={Math.max(0, Math.min(100, row.encodeProgress))}
                  className="mt-1.5"
                />
              </div>
              <span className="text-foreground-muted text-sm tabular-nums">
                {Math.max(0, Math.min(100, row.encodeProgress))}%
              </span>
            </div>
          ) : (
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
                frames={[]}
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
                {desktop ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={trimMutation.isPending}
                    onClick={() => {
                      void navigate({
                        to: "/editor",
                        search: { capture: row.id },
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
                    onClick={handleSaveTrim}
                  >
                    <ScissorsIcon />
                    {trimMutation.isPending ? "Trimming..." : "Save trim"}
                  </Button>
                ) : null}
                {trimmed && isOwner ? (
                  <p className="text-foreground-faint text-sm">
                    Saving the trim cuts the uploaded clip permanently.
                  </p>
                ) : null}
              </div>
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete clip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function gameRowFromRef(row: ClipRow): GameRow | null {
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

function mentionToSearchResult(ref: ClipMentionRef): UserSearchResult {
  return {
    id: ref.id,
    username: ref.username,
    displayUsername: ref.displayUsername,
    image: ref.image,
  }
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

function ClipEditorTabs({
  row,
  canManage,
  onRequestDelete,
  deleting,
}: {
  row: ClipRow
  canManage: boolean
  onRequestDelete: () => void
  deleting: boolean
}) {
  const [tab, setTab] = React.useState("details")

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(String(value))}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList className="shrink-0 px-4 pt-1">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="comments">
          Comments
          {row.commentCount > 0 ? (
            <TabsCount>{row.commentCount}</TabsCount>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="details"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
      >
        <ClipDetailsForm
          row={row}
          canManage={canManage}
          onRequestDelete={onRequestDelete}
          deleting={deleting}
        />
      </TabsContent>

      <TabsContent value="comments" className="min-h-0 flex-1">
        <ClipComments
          clipId={row.id}
          clipAuthorId={row.authorId}
          className="h-full border-l-0"
        />
      </TabsContent>
    </Tabs>
  )
}

/** Metadata sheet: the dialog editor's fields and dirty tracking, inline. */
function ClipDetailsForm({
  row,
  canManage,
  onRequestDelete,
  deleting,
}: {
  row: ClipRow
  canManage: boolean
  onRequestDelete: () => void
  deleting: boolean
}) {
  const [title, setTitle] = React.useState(row.title)
  const [description, setDescription] = React.useState(row.description ?? "")
  const [privacy, setPrivacy] = React.useState<ClipPrivacy>(row.privacy)
  const [game, setGame] = React.useState<GameRow | null>(() =>
    gameRowFromRef(row),
  )
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(() =>
    (row.mentions ?? []).map(mentionToSearchResult),
  )
  const [tags, setTags] = React.useState<string[]>(row.tags)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending

  const trimmedTitle = normalizeClipTitle(title)
  const trimmedDescription = normalizeClipDescription(description)
  const currentDescription = row.description ?? ""
  const originalMentionIds = (row.mentions ?? []).map((m) => m.id)
  const mentionIds = mentions.map((m) => m.id)

  const titleChanged = trimmedTitle !== row.title && trimmedTitle.length > 0
  const descriptionChanged = trimmedDescription !== currentDescription.trim()
  const privacyChanged = privacy !== row.privacy
  const gameChanged = (game?.id ?? null) !== (row.gameRef?.id ?? null)
  const mentionsChanged = !sameIdSet(mentionIds, originalMentionIds)
  const tagsChanged = !sameIdSet(tags, row.tags)

  const dirty =
    titleChanged ||
    descriptionChanged ||
    privacyChanged ||
    gameChanged ||
    mentionsChanged ||
    tagsChanged
  const titleInvalid = trimmedTitle.length === 0

  const handleSave = () => {
    if (!dirty || titleInvalid || saving) return
    const input: Parameters<typeof mutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (privacyChanged) input.privacy = privacy
    if (gameChanged && game) input.steamgriddbId = game.steamgriddbId
    if (mentionsChanged) input.mentionedUserIds = mentionIds
    if (tagsChanged) input.tags = tags
    mutation.mutate(
      { clipId: row.id, input },
      {
        onSuccess: () => toast.success("Clip updated"),
        onError: () => toast.error("Couldn't save changes"),
      },
    )
  }

  return (
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
        privacy={privacy}
        onPrivacyChange={setPrivacy}
        tags={tags}
        onTagsChange={setTags}
        disabled={saving || !canManage}
        titleInvalid={titleInvalid}
      />

      {canManage ? (
        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={deleting || saving}
            onClick={onRequestDelete}
          >
            <Trash2Icon />
            Delete
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || titleInvalid || saving}
            onClick={handleSave}
          >
            <SaveIcon />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </>
  )
}
