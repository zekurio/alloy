import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

export const TRIM_HANDLE_WIDTH_PX = 14;
const WAVEFORM_BARS = 200;
const MIN_ZOOM_SPAN_MS = 500;
const MAX_ZOOM = 40;

export function useAudioWaveform(
  file: File,
  bars: number = WAVEFORM_BARS,
): Float32Array | null {
  const [peaks, setPeaks] = React.useState<Float32Array | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function decode() {
      try {
        const arrayBuf = await file.arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44_100);
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);

        const length = audioBuffer.length;
        const merged = new Float32Array(length);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const channelData = audioBuffer.getChannelData(ch);
          for (let i = 0; i < length; i++) {
            merged[i] += channelData[i];
          }
        }
        if (audioBuffer.numberOfChannels > 1) {
          const scale = 1 / audioBuffer.numberOfChannels;
          for (let i = 0; i < length; i++) {
            merged[i] *= scale;
          }
        }

        const bucketSize = Math.max(1, Math.floor(length / bars));
        const result = new Float32Array(bars);
        let maxPeak = 0;
        for (let b = 0; b < bars; b++) {
          const start = b * bucketSize;
          const end = Math.min(start + bucketSize, length);
          let peak = 0;
          for (let i = start; i < end; i++) {
            const abs = Math.abs(merged[i]);
            if (abs > peak) peak = abs;
          }
          result[b] = peak;
          if (peak > maxPeak) maxPeak = peak;
        }

        if (maxPeak > 0) {
          for (let b = 0; b < bars; b++) {
            result[b] /= maxPeak;
          }
        }

        if (!cancelled) setPeaks(result);
      } catch {
        if (!cancelled) setPeaks(null);
      }
    }

    void decode();
    return () => {
      cancelled = true;
    };
  }, [file, bars]);

  return peaks;
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  fillStyle: string,
  viewStart: number = 0,
  viewEnd: number = 1,
) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const totalBars = peaks.length;
  const firstBar = Math.floor(viewStart * totalBars);
  const lastBar = Math.min(totalBars, Math.ceil(viewEnd * totalBars));
  const visibleBars = lastBar - firstBar;
  if (visibleBars <= 0) return;

  const barWidth = w / visibleBars;
  const gap = barWidth > 3 ? 1 : 0;
  const drawWidth = Math.max(1, barWidth - gap);
  const midY = h / 2;

  ctx.fillStyle = fillStyle;
  const radius = Math.min(drawWidth / 2, 2);

  for (let i = 0; i < visibleBars; i++) {
    const amplitude = peaks[firstBar + i];
    const barH = Math.max(1, amplitude * midY);
    const x = i * barWidth;
    const y = midY - barH;
    const h2 = barH * 2;

    ctx.beginPath();
    ctx.roundRect(x, y, drawWidth, h2, radius);
    ctx.fill();
  }
}

export function WaveformCanvas({
  peaks,
  fillStyle = "rgba(255, 255, 255, 0.35)",
  viewStart = 0,
  viewEnd = 1,
  className,
  style,
}: {
  peaks: Float32Array;
  fillStyle?: string;
  viewStart?: number;
  viewEnd?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWaveform(canvas, peaks, fillStyle, viewStart, viewEnd);
  }, [peaks, fillStyle, viewStart, viewEnd]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      drawWaveform(canvas, peaks, fillStyle, viewStart, viewEnd);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, fillStyle, viewStart, viewEnd]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}

export function useTimeMarkers(
  viewStartMs: number,
  viewEndMs: number,
  targetCount: number = 8,
) {
  return React.useMemo(() => {
    const span = viewEndMs - viewStartMs;
    if (span <= 0)
      return { major: [] as Array<{ ms: number; pct: number }>, minor: [] as Array<{ ms: number; pct: number }> };

    const niceIntervals = [
      500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
      300_000,
    ];
    const raw = span / targetCount;
    let interval = niceIntervals[niceIntervals.length - 1];
    for (const n of niceIntervals) {
      if (n >= raw) {
        interval = n;
        break;
      }
    }

    const first = Math.ceil(viewStartMs / interval) * interval;
    const major: Array<{ ms: number; pct: number }> = [];
    for (let ms = first; ms <= viewEndMs; ms += interval) {
      major.push({ ms, pct: ((ms - viewStartMs) / span) * 100 });
    }

    const minorInterval = interval / 4;
    const minorFirst = Math.ceil(viewStartMs / minorInterval) * minorInterval;
    const majorSet = new Set(major.map((m) => m.ms));
    const minor: Array<{ ms: number; pct: number }> = [];
    for (let ms = minorFirst; ms <= viewEndMs; ms += minorInterval) {
      if (!majorSet.has(ms)) {
        minor.push({ ms, pct: ((ms - viewStartMs) / span) * 100 });
      }
    }

    return { major, minor };
  }, [viewStartMs, viewEndMs, targetCount]);
}

export function useTimelineZoom(durationMs: number) {
  const [viewStartMs, setViewStartMs] = React.useState(0);
  const [viewEndMs, setViewEndMs] = React.useState(durationMs);

  React.useEffect(() => {
    setViewStartMs(0);
    setViewEndMs(durationMs);
  }, [durationMs]);

  const handleWheel = React.useCallback(
    (e: WheelEvent, cursorPct: number) => {
      e.preventDefault();

      if (e.shiftKey) {
        setViewStartMs((s) => {
          setViewEndMs((end) => {
            const span = end - s;
            const panDelta = (e.deltaY / 500) * span;
            let nextStart = s + panDelta;
            let nextEnd = end + panDelta;
            if (nextStart < 0) {
              nextEnd -= nextStart;
              nextStart = 0;
            }
            if (nextEnd > durationMs) {
              nextStart -= nextEnd - durationMs;
              nextEnd = durationMs;
            }
            nextStart = Math.max(0, nextStart);
            setViewStartMs(nextStart);
            return nextEnd;
          });
          return s;
        });
      } else {
        setViewStartMs((s) => {
          setViewEndMs((end) => {
            const span = end - s;
            const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            let nextSpan = span * zoomFactor;

            const minSpan = Math.max(MIN_ZOOM_SPAN_MS, durationMs / MAX_ZOOM);
            nextSpan = Math.max(minSpan, Math.min(durationMs, nextSpan));

            const cursorMs = s + cursorPct * span;
            let nextStart = cursorMs - cursorPct * nextSpan;
            let nextEnd = nextStart + nextSpan;

            if (nextStart < 0) {
              nextEnd -= nextStart;
              nextStart = 0;
            }
            if (nextEnd > durationMs) {
              nextStart -= nextEnd - durationMs;
              nextEnd = durationMs;
            }
            nextStart = Math.max(0, nextStart);
            nextEnd = Math.min(durationMs, nextEnd);

            setViewStartMs(nextStart);
            return nextEnd;
          });
          return s;
        });
      }
    },
    [durationMs],
  );

  const isZoomed = viewStartMs > 0.5 || viewEndMs < durationMs - 0.5;

  const resetZoom = React.useCallback(() => {
    setViewStartMs(0);
    setViewEndMs(durationMs);
  }, [durationMs]);

  return { viewStartMs, viewEndMs, handleWheel, isZoomed, resetZoom };
}

export function TrimHandle({
  side,
  onPointerDown,
  style,
}: {
  side: "start" | "end";
  onPointerDown: (e: React.PointerEvent) => void;
  style: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={side === "start" ? "Trim start" : "Trim end"}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-0 bottom-0 z-20 flex cursor-ew-resize items-center justify-center",
        "bg-accent text-accent-foreground",
        "hover:bg-accent-hover focus-visible:outline-none",
        "touch-none",
        side === "start"
          ? "rounded-l-[5px] rounded-r-none"
          : "rounded-r-[5px] rounded-l-none",
      )}
      style={{ width: TRIM_HANDLE_WIDTH_PX, ...style }}
    >
      <span className="h-5 w-[2px] rounded-full bg-accent-foreground/80" />
    </button>
  );
}
