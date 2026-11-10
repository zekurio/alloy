import { existsSync } from "node:fs"

/** What ffmpeg runs with when the env names nothing else. */
export const TRANSCODE_DEFAULTS = {
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  /** Encoder thread cap; 0 lets ffmpeg pick (all cores). */
  threads: 0,
}

const JELLYFIN_FFMPEG_PATHS = [
  "/usr/lib/jellyfin-ffmpeg/ffmpeg",
  "/usr/share/jellyfin-ffmpeg/ffmpeg",
  "/opt/homebrew/opt/jellyfin-ffmpeg/bin/ffmpeg",
  "/usr/local/opt/jellyfin-ffmpeg/bin/ffmpeg",
] as const

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
