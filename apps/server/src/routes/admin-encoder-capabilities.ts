import { spawn } from "node:child_process"

import type { AdminEncoderCapabilities as EncoderCapabilities } from "@workspace/contracts"

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

  const stdout = await runCapture(env.FFMPEG_BIN, [
    "-hide_banner",
    "-encoders",
  ]).catch(() => null)
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

  const versionStdout = await runCapture(env.FFMPEG_BIN, [
    "-hide_banner",
    "-version",
  ]).catch(() => null)
  const ffmpegVersion = versionStdout
    ? (versionStdout.split("\n")[0] ?? "").trim() || null
    : null

  return { ffmpegOk: true, ffmpegVersion, available }
}

function runCapture(bin: string, args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited ${code}`))
    })
  })
}
