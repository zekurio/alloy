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

export const ML_GAME_SUGGESTION_FRAME_COUNT = 12
export const ML_GAME_SUGGESTION_FRAME_MAX_WIDTH = 512
export const ML_GAME_SUGGESTION_MAX_FRAMES = 16
export const ML_GAME_SUGGESTION_MAX_FRAME_BYTES = 1024 * 1024
export const ML_GAME_SUGGESTION_MAX_REQUEST_BYTES =
  ML_GAME_SUGGESTION_MAX_FRAMES * ML_GAME_SUGGESTION_MAX_FRAME_BYTES

export const DEFAULT_GAME_CLASSIFIER_REPO_ID = "zekurio/alloy-clipnet-b2-v1"
export const DEFAULT_GAME_CLASSIFIER_FILENAME = "alloy-clipnet-b2-v1.pt"
export const DEFAULT_GAME_CLASSIFIER_REVISION =
  "05b8d2af2b704a21366e58e9fd6bef5cef2847cb"
export const DEFAULT_GAME_CLASSIFIER_MODEL_NAME = "alloy-game-classifier"
export const DEFAULT_GAME_CLASSIFIER_MODEL_VERSION = "alloy-clipnet-b2-v1"

export interface PublicMlGameSuggestionConfig {
  frameCount: number
  frameMaxWidth: number
  maxFrames: number
  maxFrameBytes: number
}

/** Subset of the server's ML config exposed to authenticated clients. */
export interface PublicMlConfig {
  enabled: boolean
  gameSuggestion: PublicMlGameSuggestionConfig
}
