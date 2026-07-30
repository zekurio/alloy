import {
  type ClipRow,
  clipOriginalFileUrl,
  clipRenditionFileUrl,
  clipScrubberFileUrl,
  clipThumbnailUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { Spinner } from "@alloy/ui/components/spinner"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  MediaStage,
  mediaAspectRatio,
} from "@/components/clip-editor/media-stage"
import { TrimTransportControls } from "@/components/clip-editor/transport-controls"
import { TrimBar } from "@/components/clip-editor/trim-bar"
import { useTrimPlayback } from "@/components/clip-editor/use-trim-playback"
import {
  encodeStageLabel,
  QueueProgressBar,
} from "@/components/upload/queue-progress"
import { useUploadQueue } from "@/components/upload/upload-flow-context"
import {
  AudioTrackMixerControl,
  type AudioTrackMixerController,
  useAudioTrackMixer,
} from "@/components/video/audio-track-mixer"
import {
  useExternalVideoVolume,
  VideoPlayer,
  VolumeControl,
} from "@/components/video/video-player"
import { useCapturePoster } from "@/lib/capture-poster"
import { useSetClipPosterMutation } from "@/lib/clip-queries"
import type { RecordingLibraryItem } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { canPlaySource } from "@/lib/media-capability"
import { useSpriteSheetFilmstrip } from "@/lib/media-filmstrip"

import {
  LibraryEntryNavButton,
  type NavigableLibraryEntry,
} from "./library-entry-navigation"
import {
  clearLibraryHandoffPoster,
  LibraryHandoffPosterOverlay,
  type LibraryHandoffPoster,
  readLibraryHandoffPoster,
} from "./library-handoff-poster"

export function useClipEditorMedia(
  row: ClipRow,
  processing: boolean,
  localItem: RecordingLibraryItem | null,
) {
  // Version the stream URL by the published source bytes only — deriving it
  // from thumb/status fields would reload the <video> mid-playback whenever a
  // background detail refetch lands.
  const mediaVersion = row.sourceVersion ?? ""
  const streamSrc = clipOriginalFileUrl(row.id, apiOrigin())
  const sourcePlayable = canPlaySource(
    row.sourceContentType ?? "video/mp4",
    row.sourceCodecs ?? "",
  )
  const playableRendition =
    sourcePlayable || row.trimStartMs !== null
      ? undefined
      : row.renditions.find((rendition) =>
          canPlaySource("video/mp4", rendition.codecs),
        )
  // For untrimmed clips, rendition time maps 1:1 to source time, so trim math
  // stays anchored to the original source even when previewing a rendition.
  const previewSrc = sourcePlayable
    ? streamSrc
    : playableRendition
      ? clipRenditionFileUrl(
          row.id,
          playableRendition.name,
          apiOrigin(),
          playableRendition.version,
        )
      : null
  const filmstrip = useSpriteSheetFilmstrip(
    processing ? null : clipScrubberFileUrl(row.id, apiOrigin()),
  )
  const serverPoster = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : undefined
  const localPoster = useCapturePoster({
    id: localItem?.id ?? "",
    mediaUrl: localItem?.mediaUrl ?? null,
    thumbnailUrl: localItem?.thumbnailUrl ?? null,
    durationMs: localItem?.durationMs ?? null,
    enabled: processing && Boolean(localItem),
  })
  // While the server still owes us a thumbnail, the upload queue may hold an
  // existing local library poster for the pending card.
  const uploadQueue = useUploadQueue().queue
  const queueEntry = processing
    ? uploadQueue.find((item) => item.kind === "upload" && item.id === row.id)
    : undefined
  const queuePoster =
    queueEntry?.thumbUrl ?? queueEntry?.thumbFallbackUrl ?? undefined
  const poster =
    serverPoster ?? localPoster ?? localItem?.thumbnailUrl ?? queuePoster
  const posterBlurHash = row.thumbBlurHash ?? localItem?.thumbBlurHash ?? null
  const fallbackSeed = row.gameId ?? localItem?.groupLabel ?? row.id
  const playbackSrc = processing ? (localItem?.mediaUrl ?? null) : previewSrc
  const previewUnavailable =
    !processing &&
    Boolean(row.sourceContentType || row.renditions.length > 0) &&
    previewSrc === null
  const aspectRatio = mediaAspectRatio(
    row.width ?? localItem?.width,
    row.height ?? localItem?.height,
  )
  const handoffPoster = useMemo<LibraryHandoffPoster>(
    () => ({
      src: poster,
      blurHash: posterBlurHash,
      fallbackSeed,
    }),
    [fallbackSeed, poster, posterBlurHash],
  )
  const [publishHandoffPoster, setPublishHandoffPoster] = useState(() =>
    readLibraryHandoffPoster(row.id),
  )
  const [cloudFrameReady, setCloudFrameReady] = useState(
    () => publishHandoffPoster === null,
  )

  useEffect(() => {
    setPublishHandoffPoster(readLibraryHandoffPoster(row.id))
  }, [row.id])
  useEffect(() => {
    setCloudFrameReady(publishHandoffPoster === null)
  }, [publishHandoffPoster])
  useEffect(() => {
    if (publishHandoffPoster && cloudFrameReady) {
      clearLibraryHandoffPoster(row.id)
    }
  }, [cloudFrameReady, publishHandoffPoster, row.id])

  return {
    aspectRatio,
    cloudFrameReady,
    filmstrip,
    handoffPoster,
    mediaVersion,
    playbackSrc,
    poster,
    posterBlurHash,
    previewUnavailable,
    publishHandoffPoster,
    setCloudFrameReady,
    streamSrc,
    fallbackSeed,
  }
}

type ClipEditorMediaState = ReturnType<typeof useClipEditorMedia>
type ClipEditorPlaybackState = ReturnType<typeof useTrimPlayback>

export function ClipEditorStage({
  row,
  media,
  playback,
  processing,
  canManage,
  prevEntry,
  nextEntry,
}: {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  processing: boolean
  canManage: boolean
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
}) {
  const playerVolume = useExternalVideoVolume(playback.playerRef)
  const audioMixer = useAudioTrackMixer(row.id, row.audioTracks, row.durationMs)
  // Trimmed previews use the uncut source timeline; supporting canonical-cut
  // stems here needs an explicit trim offset before the clocks can be synced.
  const editorAudioMixer =
    media.playbackSrc &&
    row.trimStartMs === null &&
    row.trimEndMs === null &&
    audioMixer.tracks.length >= 2
      ? audioMixer
      : undefined
  return (
    <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
      <MediaStage aspectRatio={media.aspectRatio}>
        {media.playbackSrc ? (
          <VideoPlayer
            src={media.playbackSrc}
            sourceIdentity={`${row.id}:${media.mediaVersion}:${media.playbackSrc}`}
            poster={media.poster}
            posterBlurHash={media.posterBlurHash}
            fallbackSeed={media.fallbackSeed}
            aspectRatio={media.aspectRatio}
            maxDisplayHeight="100%"
            controls={false}
            onVideoClick={() => playback.togglePlayback()}
            playerRef={playback.playerRef}
            onTimeUpdate={playback.handleTimeUpdate}
            onPlayingChange={playback.setPlaying}
            audioMixer={editorAudioMixer}
            onFrameReady={() => media.setCloudFrameReady(true)}
            onEnded={playback.handleEnded}
            className="overflow-hidden rounded-md"
          />
        ) : (
          <ClipEditorPreviewPlaceholder media={media} />
        )}
        <LibraryEntryNavButton side="left" target={prevEntry} />
        <LibraryEntryNavButton side="right" target={nextEntry} />
        <LibraryHandoffPosterOverlay
          poster={media.publishHandoffPoster}
          ready={media.cloudFrameReady}
        />
      </MediaStage>

      {processing ? (
        <ClipProcessingNotice
          row={row}
          playerVolume={media.playbackSrc ? playerVolume : undefined}
        />
      ) : (
        <ClipEditorTrimControls
          clipId={row.id}
          media={media}
          playback={playback}
          canManage={canManage}
          playerVolume={
            media.playbackSrc && !media.previewUnavailable
              ? playerVolume
              : undefined
          }
          audioMixer={editorAudioMixer}
        />
      )}
    </section>
  )
}

function ClipEditorPreviewPlaceholder({
  media,
}: {
  media: ClipEditorMediaState
}) {
  const poster = useImageLoaded(media.poster)
  return (
    <div className="relative size-full overflow-hidden rounded-md">
      {/* Fade the gradient out under the painted poster so its letterbox
          bars show the page background, matching video playback. */}
      <MediaPlaceholder
        seed={media.fallbackSeed}
        blurHash={media.posterBlurHash}
        aspectRatio={media.aspectRatio}
        className={cn(
          "transition-opacity duration-200 ease-out",
          poster.loaded ? "opacity-0" : "opacity-100",
        )}
      />
      {media.poster ? (
        <img
          ref={poster.ref}
          src={media.poster}
          alt=""
          className="absolute inset-0 size-full object-contain"
          decoding="async"
          onLoad={poster.markLoaded}
        />
      ) : null}
      {media.previewUnavailable ? (
        <>
          <div aria-hidden className="absolute inset-0 bg-black/40" />
          <span className="relative z-10 flex size-full items-center justify-center px-4 text-center text-sm text-white/80">
            {t(
              "Preview unavailable in this browser — scrubbing and trimming still work.",
            )}
          </span>
        </>
      ) : null}
    </div>
  )
}

function ClipEditorTrimControls({
  clipId,
  media,
  playback,
  canManage,
  playerVolume,
  audioMixer,
}: {
  clipId: string
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  canManage: boolean
  playerVolume?: ReturnType<typeof useExternalVideoVolume>
  audioMixer?: AudioTrackMixerController
}) {
  return (
    <>
      <TrimTransportControls
        playback={playback}
        trailing={
          <>
            {canManage ? (
              <SetPosterButton clipId={clipId} playback={playback} />
            ) : null}
            <AudioTrackMixerControl mixer={audioMixer} />
            {playerVolume ? (
              <VolumeControl
                muted={playerVolume.state.muted}
                volume={playerVolume.state.volume}
                onToggleMute={playerVolume.toggleMute}
                onVolumeChange={playerVolume.setVolume}
                onVolumeChangeEnd={playerVolume.finishVolumeChange}
                iconClassName="size-8 rounded-md"
                iconGlyphClassName="size-4"
              />
            ) : null}
          </>
        }
      />
      <TrimBar
        frames={media.filmstrip.frames}
        frameAspect={media.filmstrip.aspect}
        durationMs={playback.durationMs}
        startMs={playback.trim.startMs}
        endMs={playback.trim.endMs}
        subscribeCurrentMs={playback.subscribeCurrentMs}
        getCurrentMs={playback.getCurrentMs}
        onSeek={(sourceMs) => {
          playback.playerRef.current?.pause()
          playback.seek(sourceMs)
        }}
        onStartChange={playback.handleTrimStartChange}
        onEndChange={playback.handleTrimEndChange}
        onMove={playback.handleTrimMove}
      />
    </>
  )
}

/**
 * Publishes the paused frame as the clip's poster — the server extracts it
 * from the stored source at the playhead's source-time position.
 */
function SetPosterButton({
  clipId,
  playback,
}: {
  clipId: string
  playback: ClipEditorPlaybackState
}) {
  const mutation = useSetClipPosterMutation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => {
        playback.playerRef.current?.pause()
        mutation.mutate(
          { clipId, timeMs: Math.round(playback.getCurrentMs()) },
          {
            onSuccess: () => toast.success(t("Poster updated")),
            onError: (cause) =>
              toast.error(cause.message || t("Couldn't update the poster")),
          },
        )
      }}
    >
      {mutation.isPending ? <Spinner className="size-4" /> : <ImageIcon />}
      {t("Use frame as poster")}
    </Button>
  )
}

/**
 * Encode progress under the stage, presented with the same stage label and
 * bar the library cards and the watch overlay use, so the running job reads
 * identically on every clip surface.
 */
function ClipProcessingNotice({
  row,
  playerVolume,
}: {
  row: ClipRow
  playerVolume?: ReturnType<typeof useExternalVideoVolume>
}) {
  // Uncapped: the server self-caps encodeProgress at 99 until the clip is
  // ready, so the notice only ever hits 100 once playback is committed.
  const progress = Math.max(0, Math.min(100, Math.floor(row.encodeProgress)))
  return (
    <Card tone="surface" className="flex-row items-center gap-3 p-3">
      <Spinner className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          {encodeStageLabel({
            stage: row.encodeStage,
            tier: row.encodeTier,
            tierIndex: row.encodeTierIndex,
            tierCount: row.encodeTierCount,
          })}
        </p>
        <QueueProgressBar
          value={progress}
          indeterminate={progress <= 0}
          showPercent
          className="mt-1.5"
        />
      </div>
      {playerVolume ? (
        <VolumeControl
          muted={playerVolume.state.muted}
          volume={playerVolume.state.volume}
          onToggleMute={playerVolume.toggleMute}
          onVolumeChange={playerVolume.setVolume}
          onVolumeChangeEnd={playerVolume.finishVolumeChange}
          iconClassName="size-8 rounded-md"
          iconGlyphClassName="size-4"
        />
      ) : null}
    </Card>
  )
}
