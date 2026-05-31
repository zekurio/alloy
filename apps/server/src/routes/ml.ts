import { Hono, type Context } from "hono"

import type { PublicMlConfig } from "@workspace/contracts"

import { requireSession } from "../auth/require-session"
import { configStore } from "../config/store"
import { MachineLearningError, predictGameFromFrameBytes } from "../ml/client"

type MlRouteErrorStatus = 400 | 413 | 502 | 503

export const mlRoute = new Hono()
  .get("/config", requireSession, (c) => {
    const { enabled } = configStore.get("machineLearning")
    return c.json({
      enabled,
    } satisfies PublicMlConfig)
  })

  .post("/game-suggestions", requireSession, async (c) => {
    const config = configStore.get("machineLearning")
    if (!config.enabled) {
      return c.json({ error: "Machine learning is disabled" }, 503)
    }

    const formDataResult = await readMultipartFormData(c.req.raw)
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

    let frameBytes: Uint8Array[]
    try {
      frameBytes = await Promise.all(
        frames.map(async (f) => new Uint8Array(await f.arrayBuffer()))
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
  request: Request
): Promise<MultipartFormDataResult> {
  if (!isMultipartFormData(request.headers.get("content-type"))) {
    return {
      ok: false,
      status: 400,
      error: "Expected multipart/form-data",
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
