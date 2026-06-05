import type {
  block,
  clip,
  clipComment,
  clipCommentLike,
  clipLike,
  clipMention,
  clipUploadTicket,
  clipView,
  follow,
  game,
  gameFollow,
  notification,
} from "./schema"

export interface ClipVariantSettings {
  hwaccel: string
  codec: string
  audioCodec: "aac" | "none"
  quality: number
  preset?: string
  audioBitrateKbps: number
  extraInputArgs: string
  extraOutputArgs: string
  height: number
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
  /**
   * Legacy stored rendition settings. New clips do not write variants; this is
   * retained so old rows can be decoded and their assets can be cleaned up.
   */
  settings?: ClipVariantSettings
  /**
   * Legacy HLS streaming metadata from stored rendition experiments.
   */
  hls?: {
    /** Media playlist text; references the media by bare `media.m4s`. */
    playlist: string
    /** EXT-X-STREAM-INF attributes for the combined master playlist. */
    streamInf: string
  }
}

export type Game = typeof game.$inferSelect
export type NewGame = typeof game.$inferInsert
export type Clip = typeof clip.$inferSelect
export type NewClip = typeof clip.$inferInsert
export type ClipUploadTicket = typeof clipUploadTicket.$inferSelect
export type NewClipUploadTicket = typeof clipUploadTicket.$inferInsert
export type ClipLike = typeof clipLike.$inferSelect
export type ClipView = typeof clipView.$inferSelect
export type NewClipView = typeof clipView.$inferInsert
export type ClipComment = typeof clipComment.$inferSelect
export type NewClipComment = typeof clipComment.$inferInsert
export type ClipCommentLike = typeof clipCommentLike.$inferSelect
export type NewClipCommentLike = typeof clipCommentLike.$inferInsert
export type ClipMention = typeof clipMention.$inferSelect
export type Follow = typeof follow.$inferSelect
export type NewFollow = typeof follow.$inferInsert
export type GameFollow = typeof gameFollow.$inferSelect
export type NewGameFollow = typeof gameFollow.$inferInsert
export type Block = typeof block.$inferSelect
export type NewBlock = typeof block.$inferInsert
export type Notification = typeof notification.$inferSelect
export type NewNotification = typeof notification.$inferInsert
