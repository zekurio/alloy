import { Hono, type Context } from "hono"

import type { PublicMlConfig } from "@workspace/contracts"

import { requireSession } from "../auth/require-session"
import { configStore } from "../config/store"
import { MachineLearningError, predictGameFromFrameBytes } from "../ml/client"

const MAX_FRAME_BYTES = 10 * 1024 * 1024
const MULTIPART_BASE_OVERHEAD_BYTES = 1024 * 1024
const MULTIPART_FRAME_OVERHEAD_BYTES = 16 * 1024
type MlRouteErrorStatus = 400 | 413 | 502 | 503

export const mlRoute = new Hono()
  .get("/config", requireSession, (c) => {
    const { enabled, maxAnalyzeBytes, frameCount, frameWidth, topK } =
      configStore.get("machineLearning")
    return c.json({
      enabled,
      maxAnalyzeBytes,
      frameCount,
      frameWidth,
      topK,
    } satisfies PublicMlConfig)
  })

  .post("/game-suggestions", requireSession, async (c) => {
    const config = configStore.get("machineLearning")
    if (!config.enabled) {
      return c.json({ error: "Machine learning is disabled" }, 503)
    }

    const formDataResult = await readMultipartFormDataWithinLimit(
      c.req.raw,
      maxMultipartBodyBytes(config.maxAnalyzeBytes, config.frameCount),
      config.maxAnalyzeBytes
    )
    if (!formDataResult.ok) {
      return c.json({ error: formDataResult.error }, formDataResult.status)
    }
    const formData = formDataResult.formData

    const entries = formData.getAll("frames")
    if (entries.some((e) => !(e instanceof File))) {
      return c.json({ error: "Every frames field must be a file" }, 400)
    }
    const frames = entries as File[]

    if (frames.length === 0) {
      return c.json(
        { error: "Expected at least one frame in the frames field" },
        400
      )
    }
    if (frames.length > config.frameCount) {
      return c.json(
        { error: `Expected at most ${config.frameCount} frames` },
        400
      )
    }
    const totalFrameBytes = frames.reduce(
      (total, frame) => total + frame.size,
      0
    )
    if (totalFrameBytes > config.maxAnalyzeBytes) {
      return c.json(
        {
          error: `Frame payload exceeds maximum analysis size of ${formatBytes(config.maxAnalyzeBytes)}`,
        },
        413
      )
    }

    const topK = parseTopK(formData.get("topK") ?? formData.get("top_k"))
    if (typeof topK === "string") return c.json({ error: topK }, 400)

    let frameBytes: Uint8Array[]
    try {
      frameBytes = await Promise.all(
        frames.map(async (f) => {
          if (f.size > MAX_FRAME_BYTES) {
            throw new MachineLearningError(
              `Frame exceeds maximum size of ${formatBytes(MAX_FRAME_BYTES)}`,
              413
            )
          }
          return new Uint8Array(await f.arrayBuffer())
        })
      )
    } catch (cause) {
      return mlErrorResponse(c, cause)
    }

    try {
      const result = await predictGameFromFrameBytes({
        config,
        frameBytes,
        topK: topK ?? config.topK,
      })
      return c.json(result)
    } catch (cause) {
      return mlErrorResponse(c, cause)
    }
  })

function parseTopK(value: FormDataEntryValue | null): number | string | null {
  if (value === null) return null
  if (value instanceof File) return "topK must be a number"
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    return "topK must be an integer between 1 and 20"
  }
  return parsed
}

type MultipartFormDataResult =
  | { ok: true; formData: FormData }
  | { ok: false; status: 400 | 413; error: string }

async function readMultipartFormDataWithinLimit(
  request: Request,
  maxBytes: number,
  maxAnalyzeBytes: number
): Promise<MultipartFormDataResult> {
  if (!isMultipartFormData(request.headers.get("content-type"))) {
    return {
      ok: false,
      status: 400,
      error: "Expected multipart/form-data",
    }
  }

  const contentLength = parseContentLength(
    request.headers.get("content-length")
  )
  if (contentLength !== null && contentLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Frame payload exceeds maximum analysis size of ${formatBytes(maxAnalyzeBytes)}`,
    }
  }

  const body = await readBodyWithinLimit(request, maxBytes)
  if (!body.ok) {
    return {
      ok: false,
      status: 413,
      error: `Frame payload exceeds maximum analysis size of ${formatBytes(maxAnalyzeBytes)}`,
    }
  }

  try {
    const boundedRequest = new Request(request.url, {
      body: bytesToArrayBuffer(body.bytes),
      headers: request.headers,
      method: request.method,
    })
    return { ok: true, formData: await boundedRequest.formData() }
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Expected multipart/form-data",
    }
  }
}

function isMultipartFormData(contentType: string | null): boolean {
  return (
    contentType?.split(";")[0]?.trim().toLowerCase() === "multipart/form-data"
  )
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null
  return parsed
}

async function readBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  if (!request.body) return { ok: true, bytes: new Uint8Array() }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { ok: false }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

function maxMultipartBodyBytes(maxAnalyzeBytes: number, frameCount: number) {
  return (
    maxAnalyzeBytes +
    MULTIPART_BASE_OVERHEAD_BYTES +
    frameCount * MULTIPART_FRAME_OVERHEAD_BYTES
  )
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function mlErrorResponse(c: Context, cause: unknown) {
  if (cause instanceof MachineLearningError) {
    const statusCode = cause.statusCode as MlRouteErrorStatus
    return c.json(
      {
        error:
          cause.statusCode >= 500
            ? "Machine learning unavailable"
            : "Frames could not be analyzed",
        detail: cause.message,
      },
      statusCode
    )
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  return c.json({ error: "Frames could not be analyzed", detail }, 400)
}

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  if (Number.isInteger(mib)) return `${mib} MiB`
  return `${bytes} bytes`
}
