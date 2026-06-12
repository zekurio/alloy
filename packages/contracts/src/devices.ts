import type { IsoDateString } from "./shared"

/** A desktop install registered to a user; owns the clips it uploaded. */
export interface UserDeviceRow {
  id: string
  name: string
  platform: string
  lastSeenAt: IsoDateString
  createdAt: IsoDateString
}

export interface RegisterDeviceInput {
  name: string
  platform: string
}

/**
 * A single play of a game on one device. `gameName` is the raw detected
 * name; `steamgriddbId` is the server's best-effort match and may be null.
 */
export interface GameSessionRow {
  id: string
  deviceId: string
  gameName: string
  steamgriddbId: number | null
  startedAt: IsoDateString
  endedAt: IsoDateString | null
}

export interface UpsertGameSessionInput {
  deviceId: string
  gameName: string
  startedAt: IsoDateString
  endedAt?: IsoDateString
}
