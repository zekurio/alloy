import type { AdminEncoderCapabilities as EncoderCapabilities } from "@workspace/contracts"
import { logger } from "@workspace/logging"

import { env } from "../env"
import { HWACCEL_KINDS } from "../config/store"
import { codecNameFor } from "../queue/ffmpeg"

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null

export async function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
    return capabilityCache.value
  }
  const value = await probeEncoderCapabilities()
  capabilityCache = { value, expiresAt: Date.now() + 5 * 60_000 }
  return value
}

async function probeEncoderCapabilities(): Promise<EncoderCapabilities> {
  const empty: EncoderCapabilities["available"] = {
    none: { h264: false, hevc: false, av1: false },
    amf: { h264: false, hevc: false, av1: false },
    nvenc: { h264: false, hevc: false, av1: false },
    qsv: { h264: false, hevc: false, av1: false },
    rkmpp: { h264: false, hevc: false, av1: false },
    vaapi: { h264: false, hevc: false, av1: false },
    videotoolbox: { h264: false, hevc: false, av1: false },
    v4l2m2m: { h264: false, hevc: false, av1: false },
  }

  const stdout = await optionalCapture("encoder list", [
    "-hide_banner",
    "-encoders",
  ])
  if (!stdout) return { ffmpegOk: false, ffmpegVersion: null, available: empty }

  const names = new Set<string>()
  for (const line of stdout.split("\n")) {
    const m = /^\s[A-Z.]{6}\s+(\S+)/.exec(line)
    if (m && m[1]) names.add(m[1])
  }

  const available = { ...empty }
  for (const hw of HWACCEL_KINDS) {
    available[hw] = {
      h264: names.has(codecNameFor(hw, "h264")),
      hevc: names.has(codecNameFor(hw, "hevc")),
      av1: names.has(codecNameFor(hw, "av1")),
    }
  }

  const versionStdout = await optionalCapture("version", [
    "-hide_banner",
    "-version",
  ])
  const ffmpegVersion = versionStdout
    ? (versionStdout.split("\n")[0] ?? "").trim() || null
    : null

  return { ffmpegOk: true, ffmpegVersion, available }
}

async function optionalCapture(
  label: string,
  args: ReadonlyArray<string>,
): Promise<string | null> {
  try {
    return await runCapture(env.FFMPEG_BIN, args)
  } catch (err) {
    logger.warn(`[admin/encoder] ffmpeg ${label} probe failed:`, err)
    return null
  }
}

async function runCapture(
  bin: string,
  args: ReadonlyArray<string>,
): Promise<string> {
  const output = await new Deno.Command(bin, {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).output()
  if (!output.success) {
    throw new Error(`${bin} exited ${output.code}`)
  }
  return new TextDecoder().decode(output.stdout)
}
