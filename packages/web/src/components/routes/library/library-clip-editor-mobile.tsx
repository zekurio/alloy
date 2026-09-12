import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import {
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  ScissorsIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"

import { MediaStage } from "@/components/clip-editor/media-stage"
import { TrimElapsed } from "@/components/clip-editor/transport-controls"
import { TrimTimeline } from "@/components/clip-editor/trim-timeline"
import type { TrimRange } from "@/components/clip-editor/use-trim-playback"
import {
  useExternalVideoVolume,
  VideoPlayer,
  VolumeControl,
} from "@/components/video/video-player"
import { formatTrimMs } from "@/lib/media-time"

import { ClipEditorDetails } from "./library-clip-editor-details"
import {
  ClipEditorPreviewPlaceholder,
  type ClipEditorMediaState,
  type ClipEditorPlaybackState,
  ClipProcessingNotice,
  SetPosterButton,
} from "./library-clip-editor-media"
import {
  LibraryEntryNavButton,
  type NavigableLibraryEntry,
} from "./library-entry-navigation"
import { LibraryHandoffPosterOverlay } from "./library-handoff-poster"

interface MobileClipEditorProps {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  processing: boolean
  canManage: boolean
  /** True when the viewer owns a ready clip, so the trim view is reachable. */
  canTrim: boolean
  /** Persisted trim bounds; the trim view reverts to these on cancel. */
  initialTrim: TrimRange | undefined
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  details: Omit<
    Parameters<typeof ClipEditorDetails>[0],
    "row" | "onSaveMedia"
  > & {
    /** Resolves true only when the trim was persisted. */
    onSaveMedia: () => Promise<boolean>
  }
}

/**
 * Touch layout for the uploaded clip editor. The default view is just the
 * player and the details sheet — the desktop stage's transport row and
 * trimmer are a separate, full-width trim view so neither has to squeeze into
 * a phone-width column.
 */
export function MobileClipEditor({
  row,
  media,
  playback,
  processing,
  canManage,
  canTrim,
  initialTrim,
  prevEntry,
  nextEntry,
  details,
}: MobileClipEditorProps) {
  const [trimming, setTrimming] = useState(false)

  if (trimming && canTrim) {
    return (
      <MobileTrimView
        row={row}
        media={media}
        playback={playback}
        canManage={canManage}
        canSaveTrim={details.canSaveMedia}
        trimPending={details.mediaPending}
        trimError={details.mediaError}
        onSaveTrim={() => {
          // Stay in the trim view while the save is pending (the button shows
          // "Saving…") and on failure, so the unsaved handles remain editable;
          // the mutation already toasts the error.
          void details.onSaveMedia().then((saved) => {
            if (saved) setTrimming(false)
          })
        }}
        onCancel={() => {
          playback.playerRef.current?.pause()
          const restored = initialTrim ?? {
            startMs: 0,
            endMs: playback.durationMs,
          }
          playback.setTrim(restored)
          playback.setCurrentMs(restored.startMs)
          setTrimming(false)
        }}
      />
    )
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <MediaStage aspectRatio={media.aspectRatio} maxHeight="56dvh">
        {media.playbackSrc ? (
          <MobileClipVideo
            row={row}
            media={media}
            playback={playback}
            variant="preview"
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

      {processing ? <ClipProcessingNotice row={row} /> : null}
      {!processing && canTrim ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => {
            playback.playerRef.current?.pause()
            setTrimming(true)
          }}
        >
          <ScissorsIcon />
          {t("Trim clip")}
        </Button>
      ) : null}

      <Card tone="surface" role="complementary" className="min-w-0">
        <ClipEditorDetails row={row} {...details} />
      </Card>
    </section>
  )
}

/**
 * The trim view keeps the player and timeline in one full-height panel.
 * Precision comes from panning against the centred playhead and pinching to
 * zoom the time scale.
 */
function MobileTrimView({
  row,
  media,
  playback,
  canManage,
  canSaveTrim,
  trimPending,
  trimError,
  onSaveTrim,
  onCancel,
}: {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  canManage: boolean
  canSaveTrim: boolean
  trimPending: boolean
  trimError: string | null
  onSaveTrim: () => void
  onCancel: () => void
}) {
  const playerVolume = useExternalVideoVolume(playback.playerRef)
  return (
    // Fills the shell so the timeline and the commit button sit at the bottom
    // of the screen instead of floating under a short player.
    <section className="flex min-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-2rem)] w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("Cancel")}
          disabled={trimPending}
          onClick={onCancel}
        >
          <XIcon />
        </Button>
        <span className="text-foreground text-sm font-semibold">
          {t("Trim clip")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {media.playbackSrc ? (
          <MobileClipVideo
            row={row}
            media={media}
            playback={playback}
            variant="trim"
          />
        ) : (
          <MediaStage aspectRatio={media.aspectRatio} maxHeight="52dvh">
            <ClipEditorPreviewPlaceholder media={media} />
          </MediaStage>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={playback.playing ? t("Pause") : t("Play")}
          onClick={playback.togglePlayback}
        >
          {playback.playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("Stop")}
          onClick={playback.stopPlayback}
        >
          <SquareIcon />
        </Button>
        <span className="text-foreground-muted ml-1 font-mono text-sm tabular-nums">
          <TrimElapsed playback={playback} /> / {formatTrimMs(playback.rangeMs)}
        </span>
        <div className="ml-auto flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Reset trim")}
            disabled={!playback.trimmed}
            onClick={playback.resetTrim}
            className={cn(
              "text-foreground-faint transition-opacity",
              !playback.trimmed && "pointer-events-none opacity-0",
            )}
          >
            <RotateCcwIcon />
          </Button>
          {canManage ? (
            <SetPosterButton clipId={row.id} playback={playback} compact />
          ) : null}
          {media.playbackSrc && !media.previewUnavailable ? (
            <VolumeControl
              muted={playerVolume.state.muted}
              volume={playerVolume.state.volume}
              onToggleMute={playerVolume.toggleMute}
              onVolumeChange={playerVolume.setVolume}
              onVolumeChangeEnd={playerVolume.finishVolumeChange}
              iconClassName="size-9 rounded-md"
              iconGlyphClassName="size-4"
            />
          ) : null}
        </div>
      </div>

      <div className="border-border bg-surface-raised overflow-hidden rounded-lg border">
        <TrimTimeline
          waveform={media.waveform}
          durationMs={playback.durationMs}
          startMs={playback.trim.startMs}
          endMs={playback.trim.endMs}
          subscribeCurrentMs={playback.subscribeCurrentMs}
          getCurrentMs={playback.getCurrentMs}
          onScrub={(sourceMs) => {
            playback.playerRef.current?.pause()
            playback.seek(sourceMs)
          }}
          onStartChange={playback.handleTrimStartChange}
          onEndChange={playback.handleTrimEndChange}
        />
      </div>

      <p className="text-foreground-faint text-center text-xs">
        {t("Drag to scrub, pinch to zoom")}
      </p>

      {trimError ? (
        <p role="alert" className="text-destructive text-center text-sm">
          {trimError}
        </p>
      ) : null}

      <FeedbackButton
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!canSaveTrim}
        state={trimPending ? "pending" : trimError ? "error" : "idle"}
        pendingLabel={t("Saving…")}
        errorLabel={t("Try again")}
        onClick={onSaveTrim}
      >
        <SaveIcon />
        {t("Save trim")}
      </FeedbackButton>
    </section>
  )
}

function MobileClipVideo({
  row,
  media,
  playback,
  variant,
}: {
  row: ClipRow
  media: ClipEditorMediaState
  playback: ClipEditorPlaybackState
  variant: "preview" | "trim"
}) {
  if (!media.playbackSrc) return null
  const isTrim = variant === "trim"
  const onTimeUpdate = isTrim
    ? playback.handleTimeUpdate
    : (seconds: number) => {
        playback.handleTimeUpdate()
        playback.setCurrentMs(seconds * 1000)
      }

  return (
    <VideoPlayer
      src={media.playbackSrc}
      playbackRange={media.playbackRange}
      durationHint={media.durationHint}
      sourceIdentity={`${row.id}:${media.mediaVersion}:${media.playbackSrc}`}
      poster={media.poster}
      posterBlurHash={media.posterBlurHash}
      fallbackSeed={media.fallbackSeed}
      aspectRatio={media.aspectRatio}
      maxDisplayHeight={isTrim ? "52dvh" : "100%"}
      controls={!isTrim}
      chromeSize={isTrim ? undefined : "compact"}
      initialTime={playback.getCurrentMs() / 1000}
      onVideoClick={isTrim ? () => playback.togglePlayback() : undefined}
      playerRef={playback.playerRef}
      onTimeUpdate={onTimeUpdate}
      onPlayingChange={playback.setPlaying}
      onFrameReady={() => {
        media.setCloudFrameReady(true)
        playback.seek(playback.getCurrentMs())
      }}
      onEnded={playback.handleEnded}
    />
  )
}
