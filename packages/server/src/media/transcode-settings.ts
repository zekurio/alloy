import { existsSync } from "node:fs"

/**
 * Process-wide ffmpeg invocation settings. Media modules read these instead
 * of the server env so they stay importable (and testable) without full
 * server configuration; the server entrypoint applies env overrides at
 * startup before the queue runs any transcodes.
 */
export interface TranscodeSettings {
  /** ffmpeg binary to spawn. */
  ffmpegPath: string
  /** ffprobe binary to spawn. */
  ffprobePath: string
  /** Encoder thread cap; 0 lets ffmpeg pick (all cores). */
  threads: number
}

export const TRANSCODE_DEFAULTS: TranscodeSettings = {
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  threads: 0,
}

const JELLYFIN_FFMPEG_PATHS = [
  "/usr/lib/jellyfin-ffmpeg/ffmpeg",
  "/usr/share/jellyfin-ffmpeg/ffmpeg",
  "/opt/homebrew/opt/jellyfin-ffmpeg/bin/ffmpeg",
  "/usr/local/opt/jellyfin-ffmpeg/bin/ffmpeg",
] as const

let settings = TRANSCODE_DEFAULTS

export function resolveFfmpegPath(envPath: string | undefined): string {
  if (envPath) return envPath
  return (
    JELLYFIN_FFMPEG_PATHS.find((candidate) => existsSync(candidate)) ??
    TRANSCODE_DEFAULTS.ffmpegPath
  )
}

/**
 * ffprobe ships next to ffmpeg in every supported install (Jellyfin bundles,
 * Nix, distro packages), so a resolved ffmpeg path implies its sibling.
 */
export function resolveFfprobePath(
  envPath: string | undefined,
  ffmpegPath: string,
): string {
  if (envPath) return envPath
  if (ffmpegPath.endsWith("/ffmpeg")) {
    const sibling = `${ffmpegPath.slice(0, -"ffmpeg".length)}ffprobe`
    if (existsSync(sibling)) return sibling
  }
  return TRANSCODE_DEFAULTS.ffprobePath
}

export function configureTranscode(next: TranscodeSettings): void {
  settings = {
    ffmpegPath: next.ffmpegPath,
    ffprobePath: next.ffprobePath,
    threads: next.threads,
  }
}

export function transcodeSettings(): TranscodeSettings {
  return settings
}
