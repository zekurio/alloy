import type { TranscodingConfig } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { encodeRendition } from "@alloy/server/media/renditions"

const logger = createLogger("queue")

export async function encodeRenditionWithFallback(options: {
  srcPath: string
  outDir: string
  config: TranscodingConfig
  step: Parameters<typeof encodeRendition>[3]
  durationMs: number
  signal: AbortSignal
  onProgress: (fraction: number) => void
  onHardwareFailed: () => void
}) {
  try {
    return await encodeRendition(
      options.srcPath,
      options.outDir,
      options.config,
      options.step,
      {
        durationMs: options.durationMs,
        signal: options.signal,
        onProgress: options.onProgress,
      },
    )
  } catch (err) {
    // A cancelled run rejects with AbortError — not an encoder failure, so it
    // must not trigger the software fallback.
    if (options.signal.aborted) throw err
    if (options.config.hardwareAcceleration === "none") throw err
    logger.warn(
      `hardware ${options.config.hardwareAcceleration} encode failed for ${options.step.height}p; falling back to software:`,
      err,
    )
    options.onHardwareFailed()
    return encodeRendition(
      options.srcPath,
      options.outDir,
      { ...options.config, hardwareAcceleration: "none" },
      options.step,
      {
        durationMs: options.durationMs,
        signal: options.signal,
        onProgress: options.onProgress,
      },
    )
  }
}
