import type { ApiContext } from "./client"
import type {
  MlGameSuggestionResponse,
  PublicMlConfig,
} from "@workspace/contracts"
import {
  validateMlGameSuggestionResponse,
  validatePublicMlConfig,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"

export type {
  MlGameSuggestionPrediction,
  MlGameSuggestionResponse,
  PublicMlConfig,
} from "@workspace/contracts"

async function fetchMlConfig(context: ApiContext): Promise<PublicMlConfig> {
  const res = await context.client.request("/api/ml/config")
  return readJsonOrThrow(res, validatePublicMlConfig)
}

async function suggestGames(
  context: ApiContext,
  frames: Blob[]
): Promise<MlGameSuggestionResponse> {
  const body = new FormData()
  for (let i = 0; i < frames.length; i++) {
    body.append("frames", frames[i]!, `frame-${i}.jpg`)
  }

  const res = await context.client.request("/api/ml/game-suggestions", {
    method: "POST",
    init: { body },
  })

  return readJsonOrThrow(res, validateMlGameSuggestionResponse)
}

export function createMlApi(context: ApiContext) {
  return {
    getConfig: () => fetchMlConfig(context),
    suggestGames: (frames: Blob[]) => suggestGames(context, frames),
  }
}
