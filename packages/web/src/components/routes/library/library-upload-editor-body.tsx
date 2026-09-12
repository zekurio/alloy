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
import {
  ChevronUpIcon,
  CircleAlertIcon,
  CopyIcon,
  Link2Icon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"

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
import { DEFAULT_SCREENSHOT_EDIT } from "@/components/media/screenshot-edit"
import { ScreenshotEditor } from "@/components/media/screenshot-editor"
import { stripExtension } from "@/components/upload/new-clip-helpers"
import type { WebUploadMetadata } from "@/components/upload/web-upload-action"
import { VideoPlayer } from "@/components/video/video-player"
import { CLIP_DESCRIPTION_MAX, formatTags } from "@/lib/clip-fields"
import { useMediaWaveform } from "@/lib/media-waveform"

import type { UploadEditorBodyProps } from "./library-editor-body"
import { clipMetadataEditorFields } from "./library-editor-metadata"

export function UploadEditorBody({
  uploadAction,
  selected,
  previewUrl,
}: UploadEditorBodyProps) {
  const isImage = selected.contentType.startsWith("image/")
  const [screenshotEdit, setScreenshotEdit] = useState(DEFAULT_SCREENSHOT_EDIT)
  const playback = useTrimPlayback({ initialDurationMs: selected.durationMs })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const waveform = useMediaWaveform(
    isImage ? null : previewUrl,
    `upload:${previewUrl}`,
    selected.durationMs,
  )
  const aspectRatio = mediaAspectRatio(selected.width, selected.height)
  const metadata = useClipMetadataDraft({
    title: stripExtension(selected.name),
    description: "",
    game: null,
    mentions: [],
    tags: [],
  })
  const canPublish =
    !uploadAction.publishing &&
    !uploadAction.awaitingLinkCopy &&
    !metadata.titleInvalid &&
    !metadata.descriptionInvalid &&
    (isImage || rangeMs >= MIN_TRIM_MS)

  const publish = (privacy: ClipPrivacy) => {
    if (!canPublish) return
    const metadataInput: WebUploadMetadata = {
      title: metadata.normalizedTitle,
      description: metadata.normalizedDescription,
      tags: formatTags(metadata.tags),
      game: metadata.game,
      privacy,
      mentions: metadata.mentions,
      trim: { startMs: trim.startMs, endMs: trim.endMs },
      trimmed: !isImage && trimmed,
      screenshotEdit: isImage ? screenshotEdit : undefined,
    }
    void uploadAction.publish(metadataInput)
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
        <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
          {isImage ? (
            <ScreenshotEditor
              file={selected.file}
              value={screenshotEdit}
              onChange={setScreenshotEdit}
              disabled={uploadAction.publishing}
            />
          ) : (
            <>
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

              <TrimBar waveform={waveform} playback={playback} />
            </>
          )}
        </section>

        <Card
          tone="surface"
          role="complementary"
          className="min-w-0 gap-5 self-stretch overflow-visible p-4 lg:min-h-0 lg:overflow-y-auto"
        >
          <ClipMetadataEditor
            {...clipMetadataEditorFields(metadata)}
            disabled={uploadAction.publishing || uploadAction.awaitingLinkCopy}
            titleInvalid={metadata.titleInvalid}
            gameInvalid={false}
          />
          {metadata.descriptionInvalid ? (
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
