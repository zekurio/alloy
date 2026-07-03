import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useRef } from "react"

type DecodedBlurHash = {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

type WorkerResponse =
  | (DecodedBlurHash & { id: number; error?: undefined })
  | { id: number; error: string }

const DEFAULT_DECODE_WIDTH = 20
const DEFAULT_DECODE_HEIGHT = 20
const MAX_CACHE_ENTRIES = 256

let worker: Worker | null = null
let nextRequestId = 1
const cache = new Map<string, DecodedBlurHash>()
const pending = new Map<
  number,
  {
    resolve: (value: DecodedBlurHash) => void
    reject: (error: Error) => void
  }
>()

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

function blurHashWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL("../lib/blurhash-worker.ts", import.meta.url), {
    type: "module",
  })
  worker.addEventListener(
    "message",
    ({ data }: MessageEvent<WorkerResponse>) => {
      const request = pending.get(data.id)
      if (!request) return
      pending.delete(data.id)
      if (data.error !== undefined) {
        request.reject(new Error(data.error))
        return
      }
      const decoded = {
        pixels: data.pixels,
        width: data.width,
        height: data.height,
      }
      request.resolve(decoded)
    },
  )
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "BlurHash worker failed")
    for (const [id, request] of pending) {
      pending.delete(id)
      request.reject(error)
    }
  })
  return worker
}

function decodeBlurHash(
  hash: string,
  width: number,
  height: number,
): Promise<DecodedBlurHash> {
  const key = cacheKey(hash, width, height)
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pending.set(id, {
      resolve: (decoded) => {
        rememberDecoded(key, decoded)
        resolve(decoded)
      },
      reject,
    })
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage does not take a targetOrigin.
    blurHashWorker().postMessage({ id, hash, width, height })
  })
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
  const { width, height } = decodeSize(contained ? aspectRatio : undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !hash) return

    let cancelled = false
    void decodeBlurHash(hash, width, height)
      .then((decoded) => {
        if (cancelled) return
        const context = canvas.getContext("2d")
        if (!context) return
        canvas.width = decoded.width
        canvas.height = decoded.height
        const imageData = context.createImageData(decoded.width, decoded.height)
        imageData.data.set(decoded.pixels)
        context.putImageData(imageData, 0, 0)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [hash, height, width])

  if (!hash) return null

  return (
    <canvas
      ref={canvasRef}
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
