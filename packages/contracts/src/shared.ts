import type { ContractJsonInput } from "./json-value"

export type IsoDateString = string

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

export const CLIP_STATUS = ["pending", "processing", "ready", "failed"] as const
export type ClipStatus = (typeof CLIP_STATUS)[number]

/** What a recording is. Alloy currently publishes short replay/highlight clips. */
export const RECORDING_KIND = ["clip"] as const
export type RecordingKind = (typeof RECORDING_KIND)[number]

/**
 * Legacy semantic roles for isolated audio stems. Current Alloy recorders
 * produce one mixed track, but servers retain this contract for clips and
 * desktop clients released with stem support. `desktop` means system audio.
 */
export const CLIP_AUDIO_TRACK_KINDS = [
  "game",
  "microphone",
  "desktop",
  "application",
  "other",
] as const
export type ClipAudioTrackKind = (typeof CLIP_AUDIO_TRACK_KINDS)[number]

/**
 * Coerces a possibly-foreign kind value to a known one. Unknown kinds map to
 * "other" so version skew between recorder, server, and web never rejects a
 * track (or the clip carrying it) over a cosmetic classification.
 */
export function normalizeClipAudioTrackKind(
  value: ContractJsonInput,
): ClipAudioTrackKind {
  const known = CLIP_AUDIO_TRACK_KINDS.find((kind) => kind === value)
  return known ?? "other"
}

export const UPLOAD_TICKET_ROLE = ["video"] as const
export type UploadTicketRole = (typeof UPLOAD_TICKET_ROLE)[number]

export const USER_ROLES = ["user", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

// Where a game's identity comes from. SteamGridDB games are populated lazily
// from the API and kept fresh on a TTL; custom games are admin-authored and
// have no `steamgriddbId`.
export const GAME_SOURCE = ["steamgriddb", "custom"] as const
export type GameSource = (typeof GAME_SOURCE)[number]

export const USER_STATUSES = ["active", "disabled"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const USERNAME_MIN_LENGTH = 1
export const USERNAME_MAX_LENGTH = 24

// Display names are optional and free-form, so they get more room than the
// handle. Clearing one is sending an empty string, which stores null.
export const DISPLAY_NAME_MAX_LENGTH = 48

export const ACCEPTED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type AcceptedImageContentType =
  (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number]

// Uploads come from the desktop app as finished H.264/HEVC/AV1 mp4 files;
// the server never transcodes, so nothing else is accepted.
export const ACCEPTED_CLIP_CONTENT_TYPES = ["video/mp4"] as const

export type AcceptedContentType = (typeof ACCEPTED_CLIP_CONTENT_TYPES)[number]

export type UploadTicketStrategy =
  | { type: "single" }
  | { type: "chunked"; chunkSizeBytes: number }

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
  strategy?: UploadTicketStrategy
}
