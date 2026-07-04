import { isBlurHash } from "@alloy/contracts/blurhash"
import { cn } from "@alloy/ui/lib/utils"
import { decode } from "blurhash"
import { useLayoutEffect, useRef } from "react"

type DecodedBlurHash = {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

const DEFAULT_DECODE_WIDTH = 20
const DEFAULT_DECODE_HEIGHT = 20
const MAX_CACHE_ENTRIES = 256

const cache = new Map<string, DecodedBlurHash>()

function cacheKey(hash: string, width: number, height: number): string {
  return `${hash}:${width}x${height}`
}

function rememberDecoded(key: string, decoded: DecodedBlurHash): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, decoded)
  if (cache.size <= MAX_CACHE_ENTRIES) return
  const oldest = cache.keys().next().value
  if (oldest !== undefined) cache.delete(oldest)
}

function decodeBlurHash(
  hash: string,
  width: number,
  height: number,
): DecodedBlurHash {
  const key = cacheKey(hash, width, height)
  const cached = cache.get(key)
  if (cached) {
    rememberDecoded(key, cached)
    return cached
  }

  const decoded = {
    pixels: decode(hash, width, height),
    width,
    height,
  }
  rememberDecoded(key, decoded)
  return decoded
}

export function BlurHashCanvas({
  hash,
  className,
  aspectRatio,
}: {
  hash: string | null | undefined
  className?: string
  /**
   * Known aspect ratio of the media the hash was sampled from. When set, the
   * canvas letterboxes like the media (object-contain) instead of stretching
   * over the frame, so the placeholder keeps the media's shape.
   */
  aspectRatio?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const contained = typeof aspectRatio === "number" && aspectRatio > 0
  const size = decodeSize(contained ? aspectRatio : undefined)
  const validHash = hash && isBlurHash(hash) ? hash : null

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !validHash) return
    const decoded = decodeBlurHash(validHash, size.width, size.height)
    const context = canvas.getContext("2d")
    if (!context) return
    canvas.width = decoded.width
    canvas.height = decoded.height
    const imageData = context.createImageData(decoded.width, decoded.height)
    imageData.data.set(decoded.pixels)
    context.putImageData(imageData, 0, 0)
  }, [size.height, size.width, validHash])

  if (!validHash) return null

  return (
    <canvas
      ref={canvasRef}
      width={size.width}
      height={size.height}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        contained && "object-contain",
        className,
      )}
    />
  )
}

function decodeSize(aspectRatio: number | undefined): {
  width: number
  height: number
} {
  if (!aspectRatio || !Number.isFinite(aspectRatio)) {
    return { width: DEFAULT_DECODE_WIDTH, height: DEFAULT_DECODE_HEIGHT }
  }
  // Match the decode buffer's shape to the media so object-contain letterboxes
  // it exactly like the poster and video do.
  if (aspectRatio >= 1) {
    return {
      width: DEFAULT_DECODE_WIDTH,
      height: Math.max(1, Math.round(DEFAULT_DECODE_WIDTH / aspectRatio)),
    }
  }
  return {
    width: Math.max(1, Math.round(DEFAULT_DECODE_HEIGHT * aspectRatio)),
    height: DEFAULT_DECODE_HEIGHT,
  }
}
