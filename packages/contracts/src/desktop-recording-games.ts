import type { IsoDateString } from "./shared"

export interface RecordingAllowedGame {
  id: string
  name: string
  executable: string | null
  path: string | null
  windowClass?: string | null
  iconUrl?: string | null
}

export interface RecordingGameProcess {
  id: string
  name: string
  processId: number
  executable: string | null
  path: string | null
  windowTitle: string | null
  iconUrl: string | null
}

export const RECORDING_GAME_GUESS_SOURCES = [
  "discord-detectable",
  "manual",
  "plays",
  "steam-path",
  "windows-store",
  "heuristic",
] as const

export const RECORDING_GAME_GUESS_MATCH_KINDS = [
  "executable",
  "path",
  "manual",
  "heuristic",
] as const

export type RecordingGameGuessSource =
  (typeof RECORDING_GAME_GUESS_SOURCES)[number]
export type RecordingGameGuessMatchKind =
  (typeof RECORDING_GAME_GUESS_MATCH_KINDS)[number]

export interface RecordingGameGuess {
  source: RecordingGameGuessSource
  sourceId: string | null
  name: string
  aliases: string[]
  executable: string | null
  path: string | null
  windowTitle: string | null
  windowClass: string | null
  iconUrl: string | null
  confidence: number
  matchKind: RecordingGameGuessMatchKind
}

export interface RecordingGame {
  /** Stable detector id when known, e.g. a Discord/arRPC application id. */
  id: string | null
  name: string
  processId: number
  executable: string | null
  path: string | null
  iconUrl?: string | null
  windowTitle?: string | null
  windowClass?: string | null
  startedAt: IsoDateString | null
  guess: RecordingGameGuess | null
}
