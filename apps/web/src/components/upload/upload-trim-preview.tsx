import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/video/video-player";
import { VolumeControl } from "@/components/video/video-volume-control";

import { formatTimecode } from "./new-clip-helpers";
import { Button } from "@workspace/ui/components/button";
import {
  TRIM_HANDLE_WIDTH_PX,
  TrimHandle,
  WaveformCanvas,
  useAudioWaveform,
  useTimeMarkers,
  useTimelineZoom,
} from "./upload-trim-timeline-helpers";

export function VideoPreview({
  file,
  trimStartMs,
  trimEndMs,
  isPlaying,
  currentMs,
  volume,
  muted,
  onTimeUpdate,
  onPlayingChange,
  onVolumeChange,
  onToggleMute,
}: {
  file: File;
  trimStartMs: number;
  trimEndMs: number;
  isPlaying: boolean;
  currentMs: number;
  volume: number;
  muted: boolean;
  onTimeUpdate: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  const playerRef = React.useRef<VideoPlayerHandle>(null);

  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying) {
      if (p.getCurrentTime() * 1000 >= trimEndMs - 30) {
        p.seek(trimStartMs / 1000);
      }
      void p.play().catch(() => undefined);
    } else {
      p.pause();
    }
  }, [isPlaying, trimStartMs, trimEndMs]);

  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.setVolume(volume);
    p.setMuted(muted);
  }, [volume, muted]);

  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const playerMs = p.getCurrentTime() * 1000;
    if (Math.abs(playerMs - currentMs) > 50) {
      p.seek(currentMs / 1000);
    }
  }, [currentMs]);

  return (
    <div className="group/preview relative">
      <VideoPlayer
        src={file}
        controls={false}
        playerRef={playerRef}
        onVideoClick={() => onPlayingChange(!isPlaying)}
        onPlayingChange={onPlayingChange}
        onTimeUpdate={(t) => {
          onTimeUpdate(t * 1000);
          if (t * 1000 >= trimEndMs && isPlaying) {
            playerRef.current?.pause();
            onPlayingChange(false);
          }
        }}
      />

      <div
        className={cn(
          "absolute bottom-2 left-2 z-10",
          "rounded-lg border border-border/50 bg-surface-raised/90 px-1 py-0.5 shadow-md backdrop-blur-sm",
          "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/preview:opacity-100 focus-within:opacity-100",
        )}
      >
        <VolumeControl
          muted={muted}
          volume={volume}
          onToggleMute={onToggleMute}
          onVolumeChange={onVolumeChange}
        />
      </div>
    </div>
  );
}

const MIN_TRIM_MS = 100;

export function TrimTimeline({
  file,
  durationMs,
  trimStartMs,
  trimEndMs,
  currentMs,
  onTrimChange,
  onSeek,
  children,
}: {
  file: File;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  currentMs: number;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (ms: number) => void;
  /** Rendered in the footer row below the waveform (left side). */
  children?: React.ReactNode;
}) {
  const waveformPeaks = useAudioWaveform(file);
  const { viewStartMs, viewEndMs, handleWheel, isZoomed, resetZoom } =
    useTimelineZoom(durationMs);
  const { major: majorMarkers, minor: minorMarkers } = useTimeMarkers(viewStartMs, viewEndMs);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragStateRef = React.useRef<{
    kind: "start" | "end" | "playhead";
    pointerId: number;
    element: Element;
  } | null>(null);

  const viewSpan = viewEndMs - viewStartMs;

  /** Map a ms value to a percentage within the current view window. */
  const pctOf = (ms: number) =>
    viewSpan > 0
      ? Math.min(100, Math.max(0, ((ms - viewStartMs) / viewSpan) * 100))
      : 0;

  /** Map a client X coordinate to a ms value within the full duration. */
  const msFromClient = React.useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(viewStartMs + pct * (viewEndMs - viewStartMs));
    },
    [viewStartMs, viewEndMs],
  );

  // Wheel handler for zoom/pan.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const rect = root.getBoundingClientRect();
      const cursorPct = Math.min(
        1,
        Math.max(0, (e.clientX - rect.left) / rect.width),
      );
      handleWheel(e, cursorPct);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [handleWheel]);

  const startDrag = (
    kind: "start" | "end" | "playhead",
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragStateRef.current = { kind, pointerId: e.pointerId, element: target };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const ms = msFromClient(e.clientX);
    if (drag.kind === "start") {
      const next = Math.min(ms, trimEndMs - MIN_TRIM_MS);
      onTrimChange(Math.max(0, next), trimEndMs);
    } else if (drag.kind === "end") {
      const next = Math.max(ms, trimStartMs + MIN_TRIM_MS);
      onTrimChange(trimStartMs, Math.min(durationMs, next));
    } else {
      onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.element.hasPointerCapture(e.pointerId)) {
      drag.element.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current = null;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragStateRef.current) return;
    const ms = msFromClient(e.clientX);
    onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs));
  };

  const startPct = pctOf(trimStartMs);
  const endPct = pctOf(trimEndMs);

  // View window as normalised 0..1 fractions of the full duration (for
  // the waveform canvas).
  const viewFracStart = durationMs > 0 ? viewStartMs / durationMs : 0;
  const viewFracEnd = durationMs > 0 ? viewEndMs / durationMs : 1;

  const windowSpanPct = Math.max(0.01, endPct - startPct);
  const innerWidthPct = (100 / windowSpanPct) * 100;
  const innerOffsetPct = (startPct / windowSpanPct) * 100;

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-0 select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* ── Time ruler + seeker handle ────────────────────────────── */}
      <div className="flex flex-col gap-0">
        {/* Labels row */}
        <div className="relative h-4 w-full">
          {majorMarkers.map((m) => (
            <span
              key={m.ms}
              className="absolute bottom-0 -translate-x-1/2 text-[10px] font-medium text-foreground-muted tabular-nums"
              style={{ left: `${m.pct}%` }}
            >
              {formatTimecode(m.ms)}
            </span>
          ))}
        </div>

        {/* Tick bar — dark strip with ticks hanging from the top edge */}
        <div className="relative h-3 w-full rounded-sm bg-surface-raised">
          {/* Top border line */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-foreground-faint/30"
          />

          {/* Major ticks */}
          {majorMarkers.map((m) => (
            <span
              key={m.ms}
              aria-hidden
              className="absolute top-0 h-2 w-px bg-foreground-faint/50"
              style={{ left: `${m.pct}%` }}
            />
          ))}

          {/* Minor ticks */}
          {minorMarkers.map((m) => (
            <span
              key={m.ms}
              aria-hidden
              className="absolute top-0 h-1 w-px bg-foreground-faint/30"
              style={{ left: `${m.pct}%` }}
            />
          ))}

          {/* Playhead seeker — bell / funnel shape */}
          {currentMs >= viewStartMs && currentMs <= viewEndMs ? (
            <button
              type="button"
              aria-label="Playhead — drag to scrub"
              onPointerDown={(e) => startDrag("playhead", e)}
              className={cn(
                "absolute top-0 z-30 -translate-x-1/2 cursor-ew-resize",
                "touch-none focus-visible:outline-none",
              )}
              style={{ left: `${pctOf(currentMs)}%` }}
            >
              {/* Bell shape: wide rounded top tapering to a narrow stem */}
              <svg
                width="14"
                height="12"
                viewBox="0 0 14 12"
                fill="white"
                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
              >
                <path d="M1 0 H13 Q14 0 13.5 1 L8.5 10 Q7 12 5.5 10 L0.5 1 Q0 0 1 0 Z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Waveform track + trim window ─────────────────────────── */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className={cn(
          "relative h-14 w-full",
          "rounded-md bg-surface-raised",
          "overflow-hidden",
        )}
      >
        {/* Background waveform (dimmed — cut-away region) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {waveformPeaks ? (
            <WaveformCanvas
              peaks={waveformPeaks}
              fillStyle="rgba(255, 255, 255, 0.12)"
              viewStart={viewFracStart}
              viewEnd={viewFracEnd}
            />
          ) : (
            <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-foreground-faint/15" />
          )}
        </div>

        {/* Dark overlay — left of trim */}
        {startPct > 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/50"
            style={{ width: `${startPct}%` }}
          />
        ) : null}

        {/* Dark overlay — right of trim */}
        {endPct < 100 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/50"
            style={{ width: `${100 - endPct}%` }}
          />
        ) : null}

        {/* Trim window — bright waveform (clipped) + frame */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 overflow-hidden"
          style={{
            left: `${startPct}%`,
            right: `${100 - endPct}%`,
          }}
        >
          {/* Full-track-width bright canvas, offset so bars align with the
              dim background.  The parent clips it to the trim window. */}
          {waveformPeaks ? (
            <div
              className="absolute inset-y-0"
              style={{
                width: `${innerWidthPct}%`,
                left: `-${innerOffsetPct}%`,
              }}
            >
              <WaveformCanvas
                peaks={waveformPeaks}
                fillStyle="rgba(255, 255, 255, 0.5)"
                viewStart={viewFracStart}
                viewEnd={viewFracEnd}
              />
            </div>
          ) : null}

          {/* Top + bottom accent border — inset past the handles */}
          <span
            className="absolute top-0 h-[2px] bg-accent"
            style={{
              left: TRIM_HANDLE_WIDTH_PX,
              right: TRIM_HANDLE_WIDTH_PX,
            }}
          />
          <span
            className="absolute bottom-0 h-[2px] bg-accent"
            style={{
              left: TRIM_HANDLE_WIDTH_PX,
              right: TRIM_HANDLE_WIDTH_PX,
            }}
          />
        </div>

        {/* Trim handles — positioned inside the trim window */}
        <TrimHandle
          side="start"
          onPointerDown={(e) => startDrag("start", e)}
          style={{
            left: `${startPct}%`,
          }}
        />
        <TrimHandle
          side="end"
          onPointerDown={(e) => startDrag("end", e)}
          style={{
            left: `calc(${endPct}% - ${TRIM_HANDLE_WIDTH_PX}px)`,
          }}
        />

        {/* Playhead vertical line — extends from top of track to bottom */}
        {currentMs >= viewStartMs && currentMs <= viewEndMs ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]"
            style={{ left: `${pctOf(currentMs)}%` }}
          />
        ) : null}
      </div>

      {/* ── Footer row: trim info (left) + zoom reset (right) ───── */}
      <div className="mt-1.5 flex min-h-6 items-center">
        {/* Left — caller-provided content (e.g. In / duration / Out) */}
        {children ? <div className="min-w-0 flex-1">{children}</div> : null}

        {/* Right — reset zoom */}
        <div
          className={cn(
            "ml-auto shrink-0 transition-opacity duration-150",
            isZoomed ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <Button
            type="button"
            onClick={resetZoom}
            tabIndex={isZoomed ? 0 : -1}
            variant="ghost"
            size="sm"
          >
            Reset zoom
          </Button>
        </div>
      </div>
    </div>
  );
}
