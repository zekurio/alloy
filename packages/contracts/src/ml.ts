export interface MlGameSuggestionPrediction {
  rank: number
  label: string
  score: number
}

export interface MlGameSuggestionResponse {
  kind: "game-suggestion"
  advisory: true
  modelName: string
  modelVersion: string | null
  predictions: MlGameSuggestionPrediction[]
}

export interface MlErrorResponse {
  error: string
  detail?: string
}

/** Subset of the server's ML config exposed to authenticated clients. */
export interface PublicMlConfig {
  enabled: boolean
}
