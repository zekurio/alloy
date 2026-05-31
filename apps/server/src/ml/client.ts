import type {
  MachineLearningConfig,
  MlGameSuggestionPrediction,
} from "@workspace/contracts"

export interface GameClassifierResult {
  kind: "game-suggestion"
  advisory: true
  modelName: string
  modelVersion: string | null
  predictions: MlGameSuggestionPrediction[]
}

export class MachineLearningError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413 | 502 | 503 = 503
  ) {
    super(message)
    this.name = "MachineLearningError"
  }
}

export async function predictGameFromFrameBytes(input: {
  config: MachineLearningConfig
  frameBytes: Uint8Array[]
  topK: number
}): Promise<GameClassifierResult> {
  if (input.frameBytes.length === 0) {
    throw new MachineLearningError("No frames provided.", 400)
  }

  const form = new FormData()
  for (let i = 0; i < input.frameBytes.length; i++) {
    // Cast via Uint8Array<ArrayBuffer> to satisfy the BlobPart constraint —
    // Deno's Uint8Array has buffer typed as ArrayBufferLike (not ArrayBuffer).
    const bytes = input.frameBytes[i] as unknown as Uint8Array<ArrayBuffer>
    form.append(
      "frames",
      new Blob([bytes], { type: "image/jpeg" }),
      `frame-${i}.jpg`
    )
  }
  form.set("top_k", String(input.topK))

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    input.config.requestTimeoutMs
  )

  let response: Response
  try {
    response = await fetch(
      `${input.config.baseUrl}/v1/game-classifier/predict`,
      {
        method: "POST",
        body: form,
        signal: controller.signal,
      }
    )
  } catch (cause) {
    if (isAbortError(cause)) {
      throw new MachineLearningError("Machine learning request timed out.")
    }
    throw new MachineLearningError(
      cause instanceof Error
        ? `Machine learning request failed: ${cause.message}`
        : "Machine learning request failed."
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new MachineLearningError(
      await upstreamErrorMessage(response),
      response.status === 400 ? 400 : 503
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (cause) {
    throw new MachineLearningError(
      cause instanceof Error
        ? `Machine learning returned invalid JSON: ${cause.message}`
        : "Machine learning returned invalid JSON.",
      502
    )
  }

  return parseGameClassifierResult(payload, input.topK)
}

function parseGameClassifierResult(
  value: unknown,
  topK: number
): GameClassifierResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MachineLearningError(
      "Machine learning response was not an object.",
      502
    )
  }
  const obj = value as Record<string, unknown>
  if (obj.kind !== "game-suggestion" || obj.advisory !== true) {
    throw new MachineLearningError(
      "Machine learning response was not a game suggestion.",
      502
    )
  }
  if (typeof obj.modelName !== "string" || obj.modelName.trim().length === 0) {
    throw new MachineLearningError(
      "Machine learning response was missing modelName.",
      502
    )
  }
  if (obj.modelVersion !== null && typeof obj.modelVersion !== "string") {
    throw new MachineLearningError(
      "Machine learning response had an invalid modelVersion.",
      502
    )
  }
  if (!Array.isArray(obj.predictions)) {
    throw new MachineLearningError(
      "Machine learning response was missing predictions.",
      502
    )
  }

  const predictions = obj.predictions.slice(0, topK).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MachineLearningError(
        "Machine learning response contained an invalid prediction.",
        502
      )
    }
    const prediction = item as Record<string, unknown>
    if (
      typeof prediction.label !== "string" ||
      prediction.label.trim().length === 0
    ) {
      throw new MachineLearningError(
        "Machine learning response contained an invalid label.",
        502
      )
    }
    if (
      typeof prediction.score !== "number" ||
      !Number.isFinite(prediction.score) ||
      prediction.score < 0 ||
      prediction.score > 1
    ) {
      throw new MachineLearningError(
        "Machine learning response contained an invalid score.",
        502
      )
    }
    return {
      rank: index + 1,
      label: prediction.label,
      score: prediction.score,
    }
  })

  return {
    kind: "game-suggestion",
    advisory: true,
    modelName: obj.modelName,
    modelVersion: obj.modelVersion as string | null,
    predictions,
  }
}

async function upstreamErrorMessage(response: Response): Promise<string> {
  const fallback =
    response.status === 400
      ? "Machine learning rejected the frames."
      : "Machine learning is unavailable."
  const text = await response.text().catch(() => "")
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

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError"
}
