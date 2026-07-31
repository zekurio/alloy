import {
  CLIP_SCRUBBER_COLUMNS,
  CLIP_SCRUBBER_FRAME_COUNT,
  CLIP_SCRUBBER_FRAME_HEIGHT,
  CLIP_SCRUBBER_ROWS,
  CLIP_SCRUBBER_SHEET_HEIGHT,
} from "@alloy/contracts"

import { isUniformCanvasImage } from "./uniform-image"
import {
  canvasJpegBlob,
  teardownVideoElement,
  videoEvent,
} from "./video-events"

/**
 * Sprite-sheet plumbing for filmstrips: sampling evenly spaced frames from a
 * detached `<video>` into a scrubber sprite, and slicing a sprite sheet back
 * into per-frame object URLs.
 */

/** Decode height of a strip frame; cells crop the rest with object-cover. */
const FRAME_QUALITY = 0.7
/** Aspect assumed until the first frame decodes (captures are 16:9). */
const DEFAULT_FRAME_ASPECT = 16 / 9

export interface MediaFilmstrip {
  /** Object URLs of evenly spaced frames; empty while loading or on failure. */
  frames: string[]
  /** Width/height ratio of the decoded frames (display-corrected). */
  aspect: number
}

export const EMPTY_FILMSTRIP: MediaFilmstrip = {
  frames: [],
  aspect: DEFAULT_FRAME_ASPECT,
}

/**
 * Sampling state that outlives a scheduler abort. The background scheduler
 * re-invokes the same `run` closure once playback releases, so parking the
 * canvas and the set of drawn cells here means a paused/resumed trim editor
 * resumes the seek pass instead of restarting it at frame 0. Without it a
 * long capture can never finish its strip, because play/pause is the very
 * interaction the strip exists to support.
 */
export interface SpriteProgress {
  canvas: HTMLCanvasElement | null
  sampled: Set<number>
}

export async function generateFilmstripSprite(
  mediaUrl: string,
  progress: SpriteProgress,
  signal: AbortSignal,
): Promise<Blob> {
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true
  // Keeps decoded frames drawable to canvas when the media is served from
  // the API origin; harmless for same-origin and object URLs.
  video.crossOrigin = "anonymous"

  try {
    const metadataLoaded = videoEvent(video, "loadedmetadata", {
      alreadyDone: () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
      signal,
    })
    video.src = mediaUrl
    await metadataLoaded
    const durationSec = video.duration
    if (!Number.isFinite(durationSec) || !(durationSec > 0)) {
      throw new Error("Video duration is unavailable.")
    }

    let canvas = progress.canvas
    let ctx = canvas?.getContext("2d") ?? null
    for (let i = 0; i < CLIP_SCRUBBER_FRAME_COUNT; i++) {
      if (progress.sampled.has(i)) continue
      signal.throwIfAborted()
      try {
        const seeked = videoEvent(video, "seeked", { signal })
        video.currentTime =
          ((i + 0.5) / CLIP_SCRUBBER_FRAME_COUNT) * durationSec
        await seeked
      } catch (cause) {
        // A failed seek (e.g. an undecodable region) leaves the cell empty;
        // it is filled from a sampled neighbour once the pass finishes.
        if (signal.aborted) throw cause
        continue
      }
      if (!isDecodableVideoFrame(video)) continue
      if (!canvas) {
        canvas = createSpriteCanvas(video)
        ctx = canvas.getContext("2d")
        progress.canvas = canvas
      }
      if (!ctx) break
      drawSpriteCell(ctx, i, video, {
        x: 0,
        y: 0,
        width: video.videoWidth,
        height: video.videoHeight,
      })
      progress.sampled.add(i)
    }
    if (!canvas || !ctx || progress.sampled.size === 0) {
      throw new Error("No filmstrip frames could be decoded.")
    }
    fillUnsampledSpriteCells(ctx, progress.sampled)
    const blob = await canvasJpegBlob(canvas, FRAME_QUALITY)
    if (!blob) throw new Error("Could not encode filmstrip sprite.")
    return blob
  } finally {
    teardownVideoElement(video)
  }
}

/**
 * Same guards as `drawVideoFrameJpeg`: a codec the renderer cannot decode
 * still parses metadata and reports current data, but draws as a uniform
 * black cell. The sprite is persisted and uploaded, so sampling one would
 * bake that black cell in permanently.
 */
function isDecodableVideoFrame(video: HTMLVideoElement): boolean {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
  if (!video.videoWidth || !video.videoHeight) return false
  return !isUniformCanvasImage(video, video.videoWidth, video.videoHeight)
}

function createSpriteCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width =
    Math.max(
      1,
      Math.round(
        (video.videoWidth / video.videoHeight) * CLIP_SCRUBBER_FRAME_HEIGHT,
      ),
    ) * CLIP_SCRUBBER_COLUMNS
  canvas.height = CLIP_SCRUBBER_SHEET_HEIGHT
  return canvas
}

function drawSpriteCell(
  ctx: CanvasRenderingContext2D,
  index: number,
  source: CanvasImageSource,
  sourceRect: { x: number; y: number; width: number; height: number },
): void {
  const cellWidth = ctx.canvas.width / CLIP_SCRUBBER_COLUMNS
  ctx.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    (index % CLIP_SCRUBBER_COLUMNS) * cellWidth,
    Math.floor(index / CLIP_SCRUBBER_COLUMNS) * CLIP_SCRUBBER_FRAME_HEIGHT,
    cellWidth,
    CLIP_SCRUBBER_FRAME_HEIGHT,
  )
}

/**
 * Stretches the nearest sampled cell over every cell that failed to decode,
 * matching how the old per-frame strip let neighbours cover a gap. Without
 * this the sheet keeps untouched (black) cells, which the desktop cache and
 * the server promotion would then treat as the capture's real scrubber.
 */
function fillUnsampledSpriteCells(
  ctx: CanvasRenderingContext2D,
  sampled: Set<number>,
): void {
  if (sampled.size === CLIP_SCRUBBER_FRAME_COUNT) return
  const cellWidth = ctx.canvas.width / CLIP_SCRUBBER_COLUMNS
  const sampledCells = [...sampled]
  for (let i = 0; i < CLIP_SCRUBBER_FRAME_COUNT; i++) {
    if (sampled.has(i)) continue
    const nearest = sampledCells.reduce((best, index) =>
      Math.abs(index - i) < Math.abs(best - i) ? index : best,
    )
    // Drawing the canvas onto itself reads a snapshot taken before the draw.
    drawSpriteCell(ctx, i, ctx.canvas, {
      x: (nearest % CLIP_SCRUBBER_COLUMNS) * cellWidth,
      y:
        Math.floor(nearest / CLIP_SCRUBBER_COLUMNS) *
        CLIP_SCRUBBER_FRAME_HEIGHT,
      width: cellWidth,
      height: CLIP_SCRUBBER_FRAME_HEIGHT,
    })
  }
}

export async function filmstripFromSpriteBlob(
  blob: Blob,
): Promise<MediaFilmstrip> {
  const url = URL.createObjectURL(blob)
  try {
    return await extractSpriteFilmstrip(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Slice the server's scrubber sprite sheet into per-frame object URLs so the
 * trim bar consumes it exactly like a locally sampled strip.
 */
export async function extractSpriteFilmstrip(
  sheetUrl: string,
): Promise<MediaFilmstrip> {
  const image = new Image()
  // The sheet route is owner-gated behind the session cookie, so the CORS
  // request must carry credentials on split-origin deployments; the server's
  // trusted-origin CORS config allows it, and it keeps the canvas untainted.
  image.crossOrigin = "use-credentials"
  image.decoding = "async"
  image.src = sheetUrl
  await image.decode()

  const cellWidth = Math.floor(image.naturalWidth / CLIP_SCRUBBER_COLUMNS)
  const cellHeight = Math.floor(image.naturalHeight / CLIP_SCRUBBER_ROWS)
  if (!cellWidth || !cellHeight) return EMPTY_FILMSTRIP

  const frames: string[] = []
  for (let i = 0; i < CLIP_SCRUBBER_FRAME_COUNT; i++) {
    const canvas = document.createElement("canvas")
    canvas.width = cellWidth
    canvas.height = cellHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return EMPTY_FILMSTRIP
    ctx.drawImage(
      image,
      (i % CLIP_SCRUBBER_COLUMNS) * cellWidth,
      Math.floor(i / CLIP_SCRUBBER_COLUMNS) * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight,
    )
    const blob = await canvasJpegBlob(canvas, FRAME_QUALITY)
    if (!blob) return EMPTY_FILMSTRIP
    frames.push(URL.createObjectURL(blob))
  }
  return { frames, aspect: cellWidth / cellHeight }
}
