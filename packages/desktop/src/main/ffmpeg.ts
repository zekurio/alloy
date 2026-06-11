import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { logger } from "@alloy/logging"

const execFileAsync = promisify(execFile)

/** ffprobe output for long captures can run to megabytes of packet rows. */
const PROBE_MAX_BUFFER = 64 * 1024 * 1024

interface BinarySpec {
  name: "ffmpeg" | "ffprobe"
  envVar: string
  missingHint: string
}

const FFMPEG_SPEC: BinarySpec = {
  name: "ffmpeg",
  envVar: "ALLOY_FFMPEG_PATH",
  missingHint: "capture thumbnails and trims are unavailable",
}

const FFPROBE_SPEC: BinarySpec = {
  name: "ffprobe",
  envVar: "ALLOY_FFPROBE_PATH",
  missingHint: "capture keyframe markers and stream probing are unavailable",
}

const resolvedBinaries = new Map<string, string | null>()

/**
 * Resolves a usable ffmpeg-family binary once per process. Order: explicit
 * env override, a binary bundled under the app resources
 * (`resources/ffmpeg/<name>[.exe]`), then whatever the PATH offers.
 * Returns null when none of them can run `-version`.
 */
async function binaryPath(spec: BinarySpec): Promise<string | null> {
  const cached = resolvedBinaries.get(spec.name)
  if (cached !== undefined) return cached

  for (const candidate of binaryCandidates(spec)) {
    if (await canRunBinary(candidate)) {
      resolvedBinaries.set(spec.name, candidate)
      return candidate
    }
  }

  resolvedBinaries.set(spec.name, null)
  logger.warn(
    `[desktop] ${spec.name} not found (checked ${spec.envVar}, bundled resources, PATH); ` +
      spec.missingHint,
  )
  return null
}

export async function ffmpegPath(): Promise<string | null> {
  return binaryPath(FFMPEG_SPEC)
}

export async function ffprobePath(): Promise<string | null> {
  return binaryPath(FFPROBE_SPEC)
}

export async function runFfmpeg(
  args: string[],
  { timeout }: { timeout: number },
): Promise<void> {
  const binary = await ffmpegPath()
  if (!binary) throw new Error("ffmpeg is not available.")
  await execFileAsync(binary, ["-hide_banner", "-loglevel", "error", ...args], {
    timeout,
    windowsHide: true,
  })
}

/** Runs ffprobe and returns its stdout. */
export async function runFfprobe(
  args: string[],
  { timeout }: { timeout: number },
): Promise<string> {
  const binary = await ffprobePath()
  if (!binary) throw new Error("ffprobe is not available.")
  const { stdout } = await execFileAsync(
    binary,
    ["-hide_banner", "-loglevel", "error", ...args],
    {
      timeout,
      windowsHide: true,
      maxBuffer: PROBE_MAX_BUFFER,
    },
  )
  return stdout
}

function binaryCandidates(spec: BinarySpec): string[] {
  const candidates: string[] = []
  const override = process.env[spec.envVar]?.trim()
  if (override) candidates.push(override)

  const bundledName =
    process.platform === "win32" ? `${spec.name}.exe` : spec.name
  const bundled = join(process.resourcesPath ?? "", "ffmpeg", bundledName)
  if (process.resourcesPath && existsSync(bundled)) candidates.push(bundled)

  candidates.push(spec.name)
  return candidates
}

async function canRunBinary(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ["-version"], {
      timeout: 5_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}
