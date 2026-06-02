import { type Context, Hono } from "hono"

import {
  ML_GAME_SUGGESTION_FRAME_COUNT,
  ML_GAME_SUGGESTION_FRAME_MAX_WIDTH,
  ML_GAME_SUGGESTION_MAX_FRAME_BYTES,
  ML_GAME_SUGGESTION_MAX_FRAMES,
  ML_GAME_SUGGESTION_MAX_REQUEST_BYTES,
  type PublicMlConfig,
} from "@workspace/contracts"

import { requireSession } from "../auth/require-session"
import { configStore } from "../config/store"
import { MachineLearningError, predictGameFromFrameBytes } from "../ml/client"
import { errorDetail } from "../runtime/error-message"
import {
  badRequest,
  detailedErrorResponse,
  errorResult,
  payloadTooLarge,
  serviceUnavailable,
} from "../runtime/http-response"

type MlRouteErrorStatus = 400 | 413 | 502 | 503

export const mlRoute = new Hono()
  .get("/config", requireSession, (c) => {
    const { enabled } = configStore.get("machineLearning")
    return c.json(
      {
        enabled,
        gameSuggestion: {
          frameCount: ML_GAME_SUGGESTION_FRAME_COUNT,
          frameMaxWidth: ML_GAME_SUGGESTION_FRAME_MAX_WIDTH,
          maxFrames: ML_GAME_SUGGESTION_MAX_FRAMES,
          maxFrameBytes: ML_GAME_SUGGESTION_MAX_FRAME_BYTES,
        },
      } satisfies PublicMlConfig,
    )
  })
  .post("/game-suggestions", requireSession, async (c) => {
    const config = configStore.get("machineLearning")
    if (!config.enabled) {
      return serviceUnavailable(c, "Machine learning is disabled")
    }

    const formDataResult = await readMultipartFormData(c.req.raw)
    if (!formDataResult.ok) {
      return errorResult(c, formDataResult)
    }
    const formData = formDataResult.formData

    const entries = formData.getAll("frames")
    if (entries.some((e) => !(e instanceof File))) {
      return badRequest(c, "Every frames field must be a file")
    }
    const frames = entries as File[]

    if (frames.length === 0) {
      return badRequest(c, "Expected at least one frame in the frames field")
    }
    if (frames.length > ML_GAME_SUGGESTION_MAX_FRAMES) {
      return payloadTooLarge(
        c,
        `Expected at most ${ML_GAME_SUGGESTION_MAX_FRAMES} frames`,
      )
    }
    const oversizedFrame = frames.find(
      (frame) => frame.size > ML_GAME_SUGGESTION_MAX_FRAME_BYTES,
    )
    if (oversizedFrame) {
      return payloadTooLarge(
        c,
        `Each frame must be ${ML_GAME_SUGGESTION_MAX_FRAME_BYTES} bytes or smaller`,
      )
    }

    let frameBytes: Uint8Array[]
    try {
      frameBytes = await Promise.all(
        frames.map(async (f) => new Uint8Array(await f.arrayBuffer())),
      )
    } catch (cause) {
      return mlErrorResponse(c, cause)
    }

    try {
      const result = await predictGameFromFrameBytes({
        config,
        frameBytes,
      })
      return c.json(result)
    } catch (cause) {
      return mlErrorResponse(c, cause)
    }
  })

type MultipartFormDataResult =
  | { ok: true; formData: FormData }
  | { ok: false; status: 400 | 413; error: string }

async function readMultipartFormData(
  request: Request,
): Promise<MultipartFormDataResult> {
  if (!isMultipartFormData(request.headers.get("content-type"))) {
    return {
      ok: false,
      status: 400,
      error: "Expected multipart/form-data",
    }
  }

  const contentLength = Number(request.headers.get("content-length"))
  if (
    Number.isFinite(contentLength) &&
    contentLength > ML_GAME_SUGGESTION_MAX_REQUEST_BYTES
  ) {
    return {
      ok: false,
      status: 413,
      error:
        `ML frame upload must be ${ML_GAME_SUGGESTION_MAX_REQUEST_BYTES} bytes or smaller`,
    }
  }

  try {
    return { ok: true, formData: await request.formData() }
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

function mlErrorResponse(c: Context, cause: unknown) {
  if (cause instanceof MachineLearningError) {
    const statusCode = cause.statusCode as MlRouteErrorStatus
    return detailedErrorResponse(
      c,
      cause.statusCode >= 500
        ? "Machine learning unavailable"
        : "Frames could not be analyzed",
      cause.message,
      statusCode,
    )
  }
  const detail = errorDetail(cause, "Unknown error")
  return detailedErrorResponse(c, "Frames could not be analyzed", detail, 400)
}
