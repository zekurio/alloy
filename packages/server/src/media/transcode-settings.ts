/**
 * Process-wide ffmpeg invocation settings. Media modules read these instead
 * of the server env so they stay importable (and testable) without full
 * server configuration; the server entrypoint applies env overrides at
 * startup before the queue runs any transcodes.
 */
export interface TranscodeSettings {
  /** ffmpeg binary to spawn. */
  ffmpegPath: string
  /** Encoder thread cap; 0 lets ffmpeg pick (all cores). */
  threads: number
}

export const TRANSCODE_DEFAULTS: TranscodeSettings = {
  ffmpegPath: "ffmpeg",
  threads: 0,
}

let settings = TRANSCODE_DEFAULTS

export function configureTranscode(next: TranscodeSettings): void {
  settings = { ffmpegPath: next.ffmpegPath, threads: next.threads }
}

export function transcodeSettings(): TranscodeSettings {
  return settings
}
