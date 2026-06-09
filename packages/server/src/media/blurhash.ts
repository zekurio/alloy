import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"

import { encode } from "blurhash"

import { env } from "../env"
import { runCapture, runWithProgress } from "../queue/ffmpeg-process"
import { ENCODE_DIR } from "../runtime/dirs"
import { join } from "../runtime/path"

const MAX_SAMPLE_DIMENSION = 128

type ImageInput = {
  source: string
  label?: string
  signal?: AbortSignal
}

type ImageDimensions = {
  width: number
  height: number
}

export async function imageBlurHash({
  source,
  label = "image blurhash",
  signal,
}: ImageInput): Promise<string> {
  throwIfAborted(signal)
  const original = await probeImageDimensions(source, label)
  throwIfAborted(signal)
  const sample = sampleDimensions(original)

  await mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await mkdtemp(`${ENCODE_DIR}/blurhash-`)
  const rawPath = join(scratchDir, "sample.rgba")

  try {
    await runWithProgress(
      env.FFMPEG_BIN,
      [
        "-hide_banner",
        "-y",
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        `scale=${sample.width}:${sample.height}:flags=fast_bilinear`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        rawPath,
      ],
      () => undefined,
      { label, signal },
    )
    throwIfAborted(signal)
    const bytes = await readFile(rawPath)
    const expectedLength = sample.width * sample.height * 4
    if (bytes.byteLength !== expectedLength) {
      throw new Error(
        `Unexpected blurhash sample size: got ${bytes.byteLength}, expected ${expectedLength}`,
      )
    }
    const { x, y } = blurHashComponents(sample)
    return encode(
      new Uint8ClampedArray(bytes),
      sample.width,
      sample.height,
      x,
      y,
    )
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}

async function probeImageDimensions(
  source: string,
  label: string,
): Promise<ImageDimensions> {
  const { stdout } = await runCapture(
    env.FFPROBE_BIN,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      source,
    ],
    { label: `${label} probe` },
  )
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number | string; height?: number | string }>
  }
  const stream = parsed.streams?.[0]
  const width = Number.parseInt(String(stream?.width ?? 0), 10)
  const height = Number.parseInt(String(stream?.height ?? 0), 10)
  if (!width || !height) throw new Error("Could not determine image dimensions")
  return { width, height }
}

function sampleDimensions({ width, height }: ImageDimensions): ImageDimensions {
  const scale = Math.min(1, MAX_SAMPLE_DIMENSION / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function blurHashComponents({ width, height }: ImageDimensions): {
  x: number
  y: number
} {
  const xCompF = Math.sqrt((16 * width) / height)
  const yCompF = (xCompF * height) / width
  return {
    x: clampComponent(Math.floor(xCompF) + 1),
    y: clampComponent(Math.floor(yCompF) + 1),
  }
}

function clampComponent(value: number): number {
  return Math.max(1, Math.min(9, value))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new DOMException("BlurHash cancelled", "AbortError")
}
