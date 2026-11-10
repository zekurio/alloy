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
}
