export type IsoDateString = string

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

export const CLIP_STATUS = ["pending", "processing", "ready", "failed"] as const
export type ClipStatus = (typeof CLIP_STATUS)[number]

/**
 * What a recording is. `clip` is a short replay/highlight; `session` is a
 * long, full-length capture you cut clips from. Extensible — add new kinds here.
 */
export const RECORDING_KIND = ["clip", "session"] as const
export type RecordingKind = (typeof RECORDING_KIND)[number]

export const NOTIFICATION_TYPES = [
  "clip_upload_failed",
  "new_follower",
  "clip_comment",
  "comment_reply",
  "comment_pinned",
  "comment_liked_by_author",
  "new_video",
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const UPLOAD_TICKET_ROLE = ["video", "thumb"] as const
export type UploadTicketRole = (typeof UPLOAD_TICKET_ROLE)[number]

export const USER_ROLES = ["user", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ["active", "disabled"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const USERNAME_MIN_LENGTH = 1
export const USERNAME_MAX_LENGTH = 24

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

// Poster uploads. Clients may send webp directly, or JPEG when reusing a
// locally cached poster. The server republishes both as webp.
export const ACCEPTED_THUMB_CONTENT_TYPES = [
  "image/webp",
  "image/jpeg",
] as const

export type AcceptedThumbContentType =
  (typeof ACCEPTED_THUMB_CONTENT_TYPES)[number]

export type UploadTicketStrategy =
  | { type: "single" }
  | { type: "chunked"; chunkSizeBytes: number }
  | { type: "multipart"; partSizeBytes: number }

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
  strategy?: UploadTicketStrategy
}

export interface UploadPartTicket {
  uploadUrl: string
  method: "PUT"
  headers: Record<string, string>
}

export interface CompleteMultipartUploadPart {
  partNumber: number
  etag: string
}
