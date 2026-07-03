import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { ChevronUpIcon, Link2Icon, Loader2Icon, UploadIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import {
  stripExtension,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import { VideoPlayer } from "@/components/video/video-player"
import {
  CLIP_DESCRIPTION_MAX,
  formatTags,
  normalizeClipDescription,
  normalizeClipTitle,
  parseTagString,
} from "@/lib/clip-fields"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import { TrimTransportControls } from "./library-editor-shared"
import { LibraryMediaStage, mediaAspectRatio } from "./library-media-stage"
import { LibraryTrimBar } from "./library-trim-bar"
import type {
  LibraryWebUploadAction,
  WebUploadMetadata,
} from "./library-web-upload-action"
import { MIN_TRIM_MS, useTrimPlayback } from "./use-trim-playback"

/**
 * Web upload editor: the same stage-and-trimmer layout as the library clip
 * editor, driven off the locally picked File. Renders as the main content
 * region (the app sidebar and header stay in place), and trim, metadata, and
 * Post/Create Link all happen here before a single byte is uploaded — the cut
 * runs in the browser via mediabunny when the user posts.
 */
export function WebUploadEditor({
  action,
}: {
  action: LibraryWebUploadAction
}) {
  if (!action.selected || !action.previewUrl) return null
  return (
    <WebUploadEditorInner
      // Reset editor state when a different file is picked.
      key={`${action.selected.name}:${action.selected.sizeBytes}`}
      selected={action.selected}
      previewUrl={action.previewUrl}
      pending={action.publishing}
      onCancel={action.discard}
      onPublish={(metadata) => {
        void action.publish(metadata)
      }}
    />
  )
}

function WebUploadEditorInner({
  selected,
  previewUrl,
  pending,
  onCancel,
  onPublish,
}: {
  selected: SelectedFile
  previewUrl: string
  pending: boolean
  onCancel: () => void
  onPublish: (metadata: WebUploadMetadata) => void
}) {
  const playback = useTrimPlayback({ initialDurationMs: selected.durationMs })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const filmstrip = useMediaFilmstrip(previewUrl, selected.file)
  const aspectRatio = mediaAspectRatio(selected.width, selected.height)

  const [title, setTitle] = useState(stripExtension(selected.name))
  const [description, setDescription] = useState("")
  const [game, setGame] = useState<GameRow | null>(null)
  const [mentions, setMentions] = useState<UserSearchResult[]>([])
  const [tags, setTags] = useState("")

  const normalizedTitle = normalizeClipTitle(title)
  const normalizedDescription = normalizeClipDescription(description)
  const titleInvalid = normalizedTitle.length === 0
  const descriptionInvalid = normalizedDescription.length > CLIP_DESCRIPTION_MAX
  const canPublish =
    !pending && !titleInvalid && !descriptionInvalid && rangeMs >= MIN_TRIM_MS

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pending, onCancel])

  const submit = (privacy: ClipPrivacy) => {
    if (!canPublish) return
    onPublish({
      title: normalizedTitle,
      description: normalizedDescription,
      tags,
      game,
      privacy,
      mentions,
      trim: { startMs: trim.startMs, endMs: trim.endMs },
      trimmed,
    })
  }

  return (
    <AppMain className="flex min-h-0 flex-col gap-4">
      <h1 className="text-foreground text-base font-semibold">
        {t("Upload clip")}
      </h1>

      <section className="flex min-h-0 w-full flex-1 flex-col">
        <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
          <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
            <LibraryMediaStage aspectRatio={aspectRatio}>
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
                className="overflow-hidden rounded-md"
              />
            </LibraryMediaStage>

            <TrimTransportControls playback={playback} />

            <LibraryTrimBar
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
              disabled={pending}
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

            <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onCancel}
              >
                {t("Cancel")}
              </Button>
              <div className="flex items-center">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!canPublish}
                  className="rounded-r-none"
                  onClick={() => submit("public")}
                >
                  {pending ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <UploadIcon />
                  )}
                  {pending ? t("Uploading...") : t("Post")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        disabled={!canPublish}
                        aria-label={t("More upload options")}
                        className="border-l-accent-hover size-9 rounded-l-none sm:size-8"
                      />
                    }
                  >
                    <ChevronUpIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="w-52">
                    <DropdownMenuItem onClick={() => submit("unlisted")}>
                      <Link2Icon className="size-4" />
                      {t("Create Link")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </AppMain>
  )
}
