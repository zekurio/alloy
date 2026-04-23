export type {
  ClipEncodedVariant,
  ClipPrivacy,
  ClipStatus,
  ClipVariantSettings,
} from "../schema"

export type IsoDateString = string

export type SerializeDates<T> = T extends Date
  ? IsoDateString
  : T extends readonly (infer U)[]
    ? SerializeDates<U>[]
    : T extends object
      ? { [K in keyof T]: SerializeDates<T[K]> }
      : T

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

export type AcceptedContentType =
  (typeof ACCEPTED_CLIP_CONTENT_TYPES)[number]

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
}
