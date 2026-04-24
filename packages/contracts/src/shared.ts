export type IsoDateString = string

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

export const CLIP_STATUS = [
  "pending",
  "uploaded",
  "encoding",
  "ready",
  "failed",
] as const
export type ClipStatus = (typeof CLIP_STATUS)[number]

export const NOTIFICATION_TYPES = [
  "clip_upload_failed",
  "new_follower",
  "clip_comment",
  "comment_pinned",
  "comment_liked_by_author",
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface ClipVariantSettings {
  hwaccel: string
  codec: string
  audioCodec: "aac"
  quality: number
  preset?: string
  audioBitrateKbps: number
  height: number
  trimStartMs: number | null
  trimEndMs: number | null
}

export interface ClipEncodedVariant {
  id: string
  label: string
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
  settings?: ClipVariantSettings
}

export const ACCEPTED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type AcceptedImageContentType =
  (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number]

export const ACCEPTED_CLIP_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
] as const

export type AcceptedContentType = (typeof ACCEPTED_CLIP_CONTENT_TYPES)[number]

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
}
