import { createLogger } from "@alloy/logging"
import type Sharp from "sharp"

type SharpModule = typeof Sharp

const logger = createLogger("media")

let sharpModule: Promise<SharpModule> | null = null

/**
 * sharp maps libvips and starts its thread pool when imported, so it loads on
 * the first image job rather than at startup: most requests never touch an
 * image.
 */
export function loadSharp(): Promise<SharpModule> {
  sharpModule ??= import("sharp").then(
    ({ default: sharp }) => {
      // Every image is decoded once, so libvips' operation cache (up to 50 MB)
      // would only hold memory.
      sharp.cache(false)
      // sharp picks one thread under glibc but one per core under jemalloc,
      // which the Nix package preloads. Per-core threads made uploads no
      // faster and raised peak memory, so image work stays on one thread.
      sharp.concurrency(1)
      return sharp
    },
    (cause: unknown) => {
      // A broken install no longer stops startup, so say plainly what it
      // breaks, and let the next image job try again.
      sharpModule = null
      logger.error(
        "could not load sharp; image uploads, posters and blurhashes fail until it loads:",
        cause,
      )
      throw cause
    },
  )
  return sharpModule
}
