import { promises as fsp } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { env } from "../env"
import { runCapture } from "../queue/ffmpeg-process"

export interface ResizeSpec {
  width: number
  height: number
}

export const AVATAR_SPEC: ResizeSpec = { width: 512, height: 512 }
export const BANNER_SPEC: ResizeSpec = { width: 1500, height: 500 }

const ASPECT_TOLERANCE = 0.02

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImageValidationError"
  }
}

export async function resizeToJpeg(
  input: Buffer,
  spec: ResizeSpec
): Promise<Buffer> {
  const workDir = await fsp.mkdtemp(path.join(tmpdir(), "alloy-img-"))
  const inputPath = path.join(workDir, "in.bin")
  const outputPath = path.join(workDir, "out.jpg")
  try {
    await fsp.writeFile(inputPath, input)

    const { width, height } = await probeImageDimensions(inputPath)
    const srcAspect = width / height
    const targetAspect = spec.width / spec.height
    const delta = Math.abs(srcAspect - targetAspect) / targetAspect
    if (delta > ASPECT_TOLERANCE) {
      throw new ImageValidationError(
        `Aspect ratio mismatch (got ${srcAspect.toFixed(3)}, expected ${targetAspect.toFixed(3)}).`
      )
    }

    // `-q:v 3` is a sweet spot for mjpeg: visually indistinguishable from
    // the source at these sizes while keeping output well under 200 KB.
    await runCapture(env.FFMPEG_BIN, [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-vf",
      `scale=${spec.width}:${spec.height}:flags=lanczos`,
      "-q:v",
      "3",
      outputPath,
    ])
    return await fsp.readFile(outputPath)
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true })
  }
}

async function probeImageDimensions(
  filePath: string
): Promise<{ width: number; height: number }> {
  const { stdout } = await runCapture(env.FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    filePath,
  ])
  let parsed: {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>
  }
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new ImageValidationError(`Couldn't read image (${err}).`)
  }
  const stream = parsed.streams?.find((s) => s.codec_type === "video")
  if (!stream?.width || !stream?.height) {
    throw new ImageValidationError("Unsupported or corrupt image.")
  }
  return { width: stream.width, height: stream.height }
}

/**
 * Storage key layout mirrors clip assets: two-byte shards off the user id
 * to keep a single directory from swelling past a few thousand entries.
 */
export function userAssetKey(
  userId: string,
  role: "avatar" | "banner"
): string {
  const hex = userId.replace(/-/g, "")
  const aa = hex.slice(0, 2)
  const bb = hex.slice(2, 4)
  return `users/${aa}/${bb}/${userId}/${role}.jpg`
}
