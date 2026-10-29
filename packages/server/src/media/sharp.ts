import type Sharp from "sharp"

type SharpModule = typeof Sharp

let sharpModule: Promise<SharpModule> | null = null

/**
 * sharp maps libvips and starts its thread pool when imported, so it loads on
 * the first image job rather than at startup: most requests never touch an
 * image.
 */
export function loadSharp(): Promise<SharpModule> {
  sharpModule ??= import("sharp").then(({ default: sharp }) => {
    // Every image is decoded once, so libvips' operation cache (up to 50 MB)
    // would only hold memory.
    sharp.cache(false)
    // sharp picks one thread under glibc but one per core under jemalloc,
    // which the Nix package preloads. Per-core threads made uploads no faster
    // and raised peak memory, so image work stays on one thread everywhere.
    sharp.concurrency(1)
    return sharp
  })
  return sharpModule
}
