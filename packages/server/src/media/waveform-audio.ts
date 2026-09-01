import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"

/** Encode the source mix into a small file intended only for waveform reads. */
export async function extractWaveformAudio(options: {
  sourcePath: string
  outputPath: string
  durationMs: number
  signal: AbortSignal
}): Promise<void> {
  await runFfmpeg({
    args: [
      "-y",
      "-i",
      options.sourcePath,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-movflags",
      "+faststart",
      options.outputPath,
    ],
    timeoutMs: transcodeTimeoutMs(options.durationMs),
    signal: options.signal,
  })
}
