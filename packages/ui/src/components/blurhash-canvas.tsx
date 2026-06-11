import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

type DecodedBlurHash = {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

type WorkerResponse = DecodedBlurHash & {
  id: number
}

const DEFAULT_DECODE_WIDTH = 20
const DEFAULT_DECODE_HEIGHT = 20

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
        cache.set(key, decoded)
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
  width = DEFAULT_DECODE_WIDTH,
  height = DEFAULT_DECODE_HEIGHT,
}: {
  hash: string | null | undefined
  className?: string
  width?: number
  height?: number
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
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
        className,
      )}
    />
  )
}
