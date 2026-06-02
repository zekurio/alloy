import type {
  MachineLearningConfig,
  MlGameSuggestionPrediction,
} from "@workspace/contracts"

import { isAbortError, prefixedErrorMessage } from "../runtime/error-message"
import { responseTextOrEmpty } from "../runtime/response-text"

interface GameClassifierResult {
  kind: "game-suggestion"
  advisory: true
  modelName: string
  modelVersion: string | null
  predictions: MlGameSuggestionPrediction[]
}

export class MachineLearningError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413 | 502 | 503 = 503,
  ) {
    super(message)
    this.name = "MachineLearningError"
  }
}

export async function predictGameFromFrameBytes(input: {
  config: MachineLearningConfig
  frameBytes: Uint8Array[]
}): Promise<GameClassifierResult> {
  if (input.frameBytes.length === 0) {
    throw new MachineLearningError("No frames provided.", 400)
  }

  const form = new FormData()
  for (let i = 0; i < input.frameBytes.length; i++) {
    form.append(
      "frames",
      new Blob([blobSafeBytes(input.frameBytes[i])], { type: "image/jpeg" }),
      `frame-${i}.jpg`,
    )
  }
  const classifier = input.config.gameClassifier
  form.set("model_name", classifier.modelName)
  form.set("model_version", classifier.modelVersion ?? "")
  form.set("repo_id", classifier.repoId)
  form.set("filename", classifier.filename)
  form.set("revision", classifier.revision)
  form.set("checkpoint_path", classifier.checkpointPath ?? "")

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    input.config.requestTimeoutMs,
  )

  let response: Response
  try {
    response = await fetch(
      `${input.config.baseUrl}/v1/game-classifier/predict`,
      {
        method: "POST",
        body: form,
        signal: controller.signal,
      },
    )
  } catch (cause) {
    if (isAbortError(cause)) {
      throw new MachineLearningError("Machine learning request timed out.")
    }
    throw new MachineLearningError(
      prefixedErrorMessage(
        cause,
        "Machine learning request failed",
        "Machine learning request failed.",
      ),
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new MachineLearningError(
      await upstreamErrorMessage(response),
      response.status === 400 || response.status === 413
        ? response.status
        : 503,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (cause) {
    throw new MachineLearningError(
      prefixedErrorMessage(
        cause,
        "Machine learning returned invalid JSON",
        "Machine learning returned invalid JSON.",
      ),
      502,
    )
  }

  return parseGameClassifierResult(payload)
}

function blobSafeBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function parseGameClassifierResult(value: unknown): GameClassifierResult {
  const obj = mlResponseObject(
    value,
    "Machine learning response was not an object.",
  )
  if (obj.kind !== "game-suggestion" || obj.advisory !== true) {
    throw new MachineLearningError(
      "Machine learning response was not a game suggestion.",
      502,
    )
  }
  const modelName = requiredMlResponseString(
    obj.modelName,
    "Machine learning response was missing modelName.",
  )
  const modelVersion = nullableRequiredMlResponseString(
    obj.modelVersion,
    "Machine learning response had an invalid modelVersion.",
  )
  if (!Array.isArray(obj.predictions)) {
    throw new MachineLearningError(
      "Machine learning response was missing predictions.",
      502,
    )
  }

  const predictions = obj.predictions.map((item, index) => {
    const prediction = mlResponseObject(
      item,
      "Machine learning response contained an invalid prediction.",
    )
    const expectedRank = index + 1
    if (
      typeof prediction.rank !== "number" ||
      !Number.isSafeInteger(prediction.rank) ||
      prediction.rank !== expectedRank
    ) {
      throw new MachineLearningError(
        "Machine learning response contained an invalid rank.",
        502,
      )
    }
    const label = requiredMlResponseString(
      prediction.label,
      "Machine learning response contained an invalid label.",
    )
    if (
      typeof prediction.score !== "number" ||
      !Number.isFinite(prediction.score) ||
      prediction.score < 0 ||
      prediction.score > 1
    ) {
      throw new MachineLearningError(
        "Machine learning response contained an invalid score.",
        502,
      )
    }
    return {
      rank: prediction.rank,
      label,
      score: prediction.score,
    }
  })

  return {
    kind: "game-suggestion",
    advisory: true,
    modelName,
    modelVersion,
    predictions,
  }
}

function mlResponseObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MachineLearningError(message, 502)
  }
  return value as Record<string, unknown>
}

function requiredMlResponseString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MachineLearningError(message, 502)
  }
  return value.trim()
}

function nullableRequiredMlResponseString(
  value: unknown,
  message: string,
): string | null {
  if (value === null) return null
  return requiredMlResponseString(value, message)
}

async function upstreamErrorMessage(response: Response): Promise<string> {
  const fallback = response.status === 400
    ? "Machine learning rejected the frames."
    : response.status === 413
    ? "Machine learning rejected an oversized request."
    : "Machine learning is unavailable."
  const text = await responseTextOrEmpty(response, "machine learning error")
  if (!text.trim()) return fallback
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      const detail = (parsed as { detail?: unknown }).detail
      if (typeof detail === "string" && detail.trim()) return detail
    }
  } catch {
    // Plain-text upstream errors are still useful, as long as they are short.
  }
  return text.trim().slice(0, 500)
}
