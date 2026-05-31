import { Hono, type Context } from "hono"

import type { PublicMlConfig } from "@workspace/contracts"

import { requireSession } from "../auth/require-session"
import { configStore } from "../config/store"
import { MachineLearningError, predictGameFromFrameBytes } from "../ml/client"

const MAX_FRAME_BYTES = 10 * 1024 * 1024
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

    let formData: FormData
    try {
      formData = await c.req.raw.formData()
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400)
    }

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
