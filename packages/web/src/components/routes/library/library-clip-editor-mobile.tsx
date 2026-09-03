import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import {
  AudioLinesIcon,
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
  AudioTrackMixerTracks,
  type AudioTrackMixerController,
} from "@/components/video/audio-track-mixer"
import {
  useExternalVideoVolume,
  VideoPlayer,
  VolumeControl,
} from "@/components/video/video-player"
import { formatTrimMs } from "@/lib/media-time"

import { ClipEditorTabs } from "./library-clip-editor-details"
import {
  ClipEditorPreviewPlaceholder,
  type ClipEditorMediaState,
  type ClipEditorPlaybackState,
  ClipProcessingNotice,
  SetPosterButton,
  useClipEditorAudioMixer,
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
  tabs: Omit<Parameters<typeof ClipEditorTabs>[0], "row" | "onSaveTrim"> & {
    /** Resolves true only when the trim was persisted. */
    onSaveTrim: () => Promise<boolean>
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
  tabs,
}: MobileClipEditorProps) {
  const [trimming, setTrimming] = useState(false)
  // Held here so the mix survives switching between the two views, which
  // remounts the player (chromed preview vs. bare trim stage).
  const audioMixer = useClipEditorAudioMixer(row, media)

  if (trimming && canTrim) {
    return (
      <MobileTrimView
        row={row}
        media={media}
        playback={playback}
        canManage={canManage}
        audioMixer={audioMixer}
        canSaveTrim={tabs.canSaveTrim}
        trimPending={tabs.trimPending}
        trimError={tabs.trimError}
        onSaveTrim={() => {
          // Stay in the trim view while the save is pending (the button shows
          // "Saving…") and on failure, so the unsaved handles remain editable;
          // the mutation already toasts the error.
          void tabs.onSaveTrim().then((saved) => {
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
          <VideoPlayer
            src={media.playbackSrc}
            playbackRange={media.playbackRange}
            durationHint={media.durationHint}
            sourceIdentity={`${row.id}:${media.mediaVersion}:${media.playbackSrc}`}
            poster={media.poster}
            posterBlurHash={media.posterBlurHash}
            fallbackSeed={media.fallbackSeed}
            aspectRatio={media.aspectRatio}
            maxDisplayHeight="100%"
            chromeSize="compact"
            initialTime={playback.getCurrentMs() / 1000}
            playerRef={playback.playerRef}
            onTimeUpdate={(seconds) => {
              playback.handleTimeUpdate()
              // The chrome scrubber moves the player directly, so publish its
              // position too — the trim view opens on the frame shown here.
              playback.setCurrentMs(seconds * 1000)
            }}
            onPlayingChange={playback.setPlaying}
            audioMixer={audioMixer}
            onFrameReady={() => {
              media.setCloudFrameReady(true)
              // Switching views mounts a fresh element at zero; catch it up to
              // the playhead the trim view (or a cancel) left off at.
              playback.seek(playback.getCurrentMs())
            }}
            onEnded={playback.handleEnded}
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
        <ClipEditorTabs row={row} commentsFlow="page" {...tabs} />
      </Card>
    </section>
  )
}

/**
 * The trim view: player over one editor panel holding the timeline and the
 * stem mixer. Precision comes from the timeline itself — pan against the
 * centred playhead, pinch to zoom the time scale — so nothing below it exists
 * to compensate for coarse handles.
 */
function MobileTrimView({
  row,
  media,
  playback,
  canManage,
  audioMixer,
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
  audioMixer: AudioTrackMixerController | undefined
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
          <VideoPlayer
            src={media.playbackSrc}
            playbackRange={media.playbackRange}
            durationHint={media.durationHint}
            sourceIdentity={`${row.id}:${media.mediaVersion}:${media.playbackSrc}`}
            poster={media.poster}
            posterBlurHash={media.posterBlurHash}
            fallbackSeed={media.fallbackSeed}
            aspectRatio={media.aspectRatio}
            maxDisplayHeight="52dvh"
            controls={false}
            initialTime={playback.getCurrentMs() / 1000}
            onVideoClick={() => playback.togglePlayback()}
            playerRef={playback.playerRef}
            onTimeUpdate={playback.handleTimeUpdate}
            onPlayingChange={playback.setPlaying}
            audioMixer={audioMixer}
            onFrameReady={() => {
              media.setCloudFrameReady(true)
              // Switching views mounts a fresh element at zero; catch it up to
              // the playhead the details view left off at.
              playback.seek(playback.getCurrentMs())
            }}
            onEnded={playback.handleEnded}
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

        {audioMixer ? (
          <div className="border-border border-t p-3">
            <div className="text-foreground-muted mb-2 flex items-center gap-2">
              <AudioLinesIcon className="size-4" />
              <span className="text-xs font-semibold">{t("Audio tracks")}</span>
            </div>
            <AudioTrackMixerTracks mixer={audioMixer} touch />
          </div>
        ) : null}
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
