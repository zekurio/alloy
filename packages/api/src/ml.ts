import type { MlGameSuggestionResponse, PublicMlConfig } from "alloy-contracts"

import type { ApiContext } from "./client"
import {
  validateMlGameSuggestionResponse,
  validatePublicMlConfig,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"

export type {
  MlGameSuggestionPrediction,
  MlGameSuggestionResponse,
  PublicMlConfig,
} from "alloy-contracts"

async function fetchMlConfig(context: ApiContext): Promise<PublicMlConfig> {
  const res = await context.rpc.api.ml.config.$get()
  return readJsonOrThrow(res, validatePublicMlConfig)
}

async function suggestGames(
  context: ApiContext,
  frames: Blob[],
): Promise<MlGameSuggestionResponse> {
  const body = new FormData()
  for (const [i, frame] of frames.entries()) {
    body.append("frames", frame, `frame-${i}.jpg`)
  }

  const res = await context.rpc.api.ml["game-suggestions"].$post(
    {},
    { init: { body } },
  )

  return readJsonOrThrow(res, validateMlGameSuggestionResponse)
}

export function createMlApi(context: ApiContext) {
  return {
    getConfig: () => fetchMlConfig(context),
    suggestGames: (frames: Blob[]) => suggestGames(context, frames),
  }
}
