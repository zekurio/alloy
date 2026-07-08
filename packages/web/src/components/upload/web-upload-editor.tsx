import type { ClipPrivacy } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Dialog, DialogViewportContent } from "@alloy/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { ChevronUpIcon, Link2Icon, Loader2Icon, UploadIcon } from "lucide-react"

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
  stripExtension,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import { VideoPlayer } from "@/components/video/video-player"
import { CLIP_DESCRIPTION_MAX, formatTags } from "@/lib/clip-fields"
import { useMediaFilmstrip } from "@/lib/media-filmstrip"

import type { WebUploadAction, WebUploadMetadata } from "./web-upload-action"

/**
 * Web upload editor: the same stage-and-trimmer layout as the library clip
 * editor, driven off the locally picked File, presented as a global
 * full-viewport dialog reachable from any route. Trim, metadata, and
 * Post/Create Link all happen here before a single byte is uploaded — the
 * file uploads untouched and the server derives the trim cut at ingest.
 */
export function WebUploadEditor({ action }: { action: WebUploadAction }) {
  const open = action.selected !== null && action.previewUrl !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) action.discard()
      }}
      disablePointerDismissal
    >
      <DialogViewportContent className="flex flex-col p-0">
        {open && action.selected && action.previewUrl ? (
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
        ) : null}
      </DialogViewportContent>
    </Dialog>
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
  const filmstrip = useMediaFilmstrip(previewUrl)
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
    !pending && !titleInvalid && !descriptionInvalid && rangeMs >= MIN_TRIM_MS

  const submit = (privacy: ClipPrivacy) => {
    if (!canPublish) return
    onPublish({
      title: normalizedTitle,
      description: normalizedDescription,
      tags: formatTags(tags),
      game,
      privacy,
      mentions,
      trim: { startMs: trim.startMs, endMs: trim.endMs },
      trimmed,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <h1 className="text-foreground text-base font-semibold">
        {t("Upload clip")}
      </h1>

      <section className="flex min-h-0 w-full flex-1 flex-col">
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
                className="overflow-hidden rounded-md"
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
              tags={tags}
              onTagsChange={setTags}
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
    </div>
  )
}
