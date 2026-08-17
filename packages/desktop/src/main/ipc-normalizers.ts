import {
  CLIP_PRIVACY,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  type RecordingCaptureMention,
  type RecordingLibraryCommitStagedImportRequest,
  type RecordingLibraryDownloadRequest,
  type RecordingLibraryExportRequest,
  type RecordingLibraryMetaPatch,
  type RecordingLibraryTrimUpdate,
  type RecordingNotificationSoundEvent,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"

import {
  StrictFiniteNumberSchema,
  StrictStringSchema,
} from "./runtime-validation"

const AnyIpcValueSchema = t.unknown()
type IpcInput = Parameters<typeof AnyIpcValueSchema.safeParse>[0]

export function isNotificationSoundEvent(
  value: IpcInput,
): value is RecordingNotificationSoundEvent {
  return RECORDING_NOTIFICATION_SOUND_EVENTS.some((event) => event === value)
}

const EXPORT_SEGMENTS_MAX = 100
const TrimMsSchema = StrictFiniteNumberSchema.transform((value) =>
  Math.max(0, Math.trunc(value)),
)
const LibraryExportEnvelopeSchema = t
  .looseObject({
    id: StrictStringSchema.catch("").$default(""),
    segments: t.array(AnyIpcValueSchema).catch([]).$default([]),
  })
  .catch({ id: "", segments: [] })
const LibraryExportSegmentSchema = t.looseObject({
  startMs: TrimMsSchema.catch(0).$default(0),
  endMs: TrimMsSchema.catch(0).$default(0),
})

export function normalizeLibraryExportRequest(
  value: IpcInput,
): RecordingLibraryExportRequest {
  const request = LibraryExportEnvelopeSchema.parse(value)
  return {
    id: request.id,
    segments: request.segments
      .slice(0, EXPORT_SEGMENTS_MAX)
      .flatMap((entry) => {
        const result = LibraryExportSegmentSchema.safeParse(entry)
        return result.success ? [result.data] : []
      }),
  }
}

const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024
const COMMIT_STAGED_IMPORT_ID_MAX = 128
const COMMIT_STAGED_IMPORT_TITLE_MAX = 200
const COMMIT_STAGED_IMPORT_GAME_NAME_MAX = 200
const COMMIT_STAGED_IMPORT_GAME_ICON_URL_MAX = 2000
const LibraryCommitStagedImportSchema = t.looseObject({
  id: StrictStringSchema.min(1).max(COMMIT_STAGED_IMPORT_ID_MAX),
  title: StrictStringSchema.trim()
    .min(1)
    .transform((value) => value.slice(0, COMMIT_STAGED_IMPORT_TITLE_MAX)),
  gameName: StrictStringSchema.trim()
    .min(1)
    .transform((value) => value.slice(0, COMMIT_STAGED_IMPORT_GAME_NAME_MAX)),
  gameIconUrl: StrictStringSchema.transform((value) =>
    value.slice(0, COMMIT_STAGED_IMPORT_GAME_ICON_URL_MAX),
  )
    .nullable()
    .catch(null)
    .$default(null),
})

export function normalizeLibraryCommitStagedImportRequest(
  value: IpcInput,
): RecordingLibraryCommitStagedImportRequest | null {
  const result = LibraryCommitStagedImportSchema.safeParse(value)
  return result.success ? result.data : null
}

const LibraryThumbnailSaveSchema = t.looseObject({
  id: StrictStringSchema.min(1),
  data: t
    .instanceof(Uint8Array)
    .refine(
      (data) => data.byteLength > 0 && data.byteLength <= THUMBNAIL_MAX_BYTES,
    ),
})

export function normalizeLibraryThumbnailSaveRequest(
  id: IpcInput,
  data: IpcInput,
): { id: string; data: Uint8Array } | null {
  const result = LibraryThumbnailSaveSchema.safeParse({ id, data })
  return result.success ? result.data : null
}

const DOWNLOAD_TITLE_MAX = 200
const DOWNLOAD_ID_MAX = 64
const DOWNLOAD_URL_MAX = 2000
const DOWNLOAD_GAME_NAME_MAX = 200
const DOWNLOAD_CONTENT_TYPE_MAX = 100
const PositiveIntegerSchema = StrictFiniteNumberSchema.refine(
  (value) => Number.isFinite(value) && value > 0,
).transform(Math.round)
const LibraryDownloadRequestSchema = t.looseObject({
  clipId: StrictStringSchema.min(1).max(DOWNLOAD_ID_MAX),
  title: StrictStringSchema.trim()
    .transform((value) => value.slice(0, DOWNLOAD_TITLE_MAX))
    .catch("")
    .$default(""),
  mediaUrl: StrictStringSchema.min(1).max(DOWNLOAD_URL_MAX),
  contentType: StrictStringSchema.transform((value) =>
    value.slice(0, DOWNLOAD_CONTENT_TYPE_MAX),
  )
    .nullable()
    .catch(null)
    .$default(null),
  sizeBytes: PositiveIntegerSchema.nullable().catch(null).$default(null),
  durationMs: PositiveIntegerSchema.nullable().catch(null).$default(null),
  width: PositiveIntegerSchema.nullable().catch(null).$default(null),
  height: PositiveIntegerSchema.nullable().catch(null).$default(null),
  gameName: StrictStringSchema.transform((value) =>
    value.slice(0, DOWNLOAD_GAME_NAME_MAX),
  )
    .nullable()
    .catch(null)
    .$default(null),
})

/**
 * Returns a sanitized clip download request, or null when it lacks a usable
 * clip id or media URL. The IPC handler checks the URL origin.
 */
export function normalizeLibraryDownloadRequest(
  value: IpcInput,
): RecordingLibraryDownloadRequest | null {
  const result = LibraryDownloadRequestSchema.safeParse(value)
  if (!result.success) return null
  return { ...result.data, title: result.data.title || "Clip" }
}

const META_TITLE_MAX = 200
const META_GAME_NAME_MAX = 200
const META_GAME_ICON_URL_MAX = 2000
const META_DESCRIPTION_MAX = 4000
const META_TAGS_MAX = 500
const META_MENTIONS_MAX = 50
const CaptureMentionSchema = t.looseObject({
  id: StrictStringSchema.min(1),
  username: StrictStringSchema.catch("").$default(""),
  image: StrictStringSchema.nullable().catch(null).$default(null),
})
const LibraryMetaPatchEnvelopeSchema = t.looseObject({
  id: StrictStringSchema.min(1),
  title: AnyIpcValueSchema.optional(),
  gameName: AnyIpcValueSchema.optional(),
  gameIconUrl: AnyIpcValueSchema.optional(),
  description: AnyIpcValueSchema.optional(),
  tags: AnyIpcValueSchema.optional(),
  mentions: t.array(AnyIpcValueSchema).optional(),
  privacy: AnyIpcValueSchema.optional(),
  uploadedClipId: AnyIpcValueSchema.optional(),
})

/** Returns a sanitized draft-metadata patch, or null for an invalid id. */
export function normalizeLibraryMetaPatch(
  value: IpcInput,
): RecordingLibraryMetaPatch | null {
  const result = LibraryMetaPatchEnvelopeSchema.safeParse(value)
  if (!result.success) return null

  const patch: RecordingLibraryMetaPatch = { id: result.data.id }
  const title = StrictStringSchema.safeParse(result.data.title)
  if (title.success) {
    const normalized = title.data.trim().slice(0, META_TITLE_MAX)
    if (normalized.length > 0) patch.title = normalized
  }
  const gameName = StrictStringSchema.nullable().safeParse(result.data.gameName)
  if (gameName.success) {
    const normalized = gameName.data?.trim().slice(0, META_GAME_NAME_MAX)
    patch.gameName = normalized && normalized.length > 0 ? normalized : null
  }
  const gameIconUrl = StrictStringSchema.nullable().safeParse(
    result.data.gameIconUrl,
  )
  if (gameIconUrl.success) {
    patch.gameIconUrl =
      gameIconUrl.data?.slice(0, META_GAME_ICON_URL_MAX) ?? null
  }
  const description = StrictStringSchema.nullable().safeParse(
    result.data.description,
  )
  if (description.success) {
    patch.description = description.data?.slice(0, META_DESCRIPTION_MAX) ?? null
  }
  const tags = StrictStringSchema.nullable().safeParse(result.data.tags)
  if (tags.success) patch.tags = tags.data?.slice(0, META_TAGS_MAX) ?? null
  if (result.data.mentions) {
    patch.mentions = result.data.mentions
      .slice(0, META_MENTIONS_MAX)
      .flatMap((mention): RecordingCaptureMention[] => {
        const parsed = CaptureMentionSchema.safeParse(mention)
        return parsed.success ? [parsed.data] : []
      })
  }
  if (result.data.privacy === null) patch.privacy = null
  const privacy = CLIP_PRIVACY.find(
    (candidate) => candidate === result.data.privacy,
  )
  if (privacy !== undefined) patch.privacy = privacy
  const uploadedClipId = StrictStringSchema.min(1)
    .max(64)
    .nullable()
    .safeParse(result.data.uploadedClipId)
  if (uploadedClipId.success) patch.uploadedClipId = uploadedClipId.data
  return patch
}

const TrimBoundSchema = StrictFiniteNumberSchema.refine(
  (value) => Number.isFinite(value) && value >= 0,
).transform((value) => Math.min(Math.round(value), Number.MAX_SAFE_INTEGER))
const LibraryTrimUpdateSchema = t
  .looseObject({
    id: StrictStringSchema.min(1),
    trimStartMs: TrimBoundSchema.nullable(),
    trimEndMs: TrimBoundSchema.nullable(),
  })
  .refine(
    (value) =>
      (value.trimStartMs === null && value.trimEndMs === null) ||
      (value.trimStartMs !== null &&
        value.trimEndMs !== null &&
        value.trimEndMs > value.trimStartMs),
  )

/** Returns a valid trim range, a clear request, or null. */
export function normalizeLibraryTrimUpdate(
  value: IpcInput,
): RecordingLibraryTrimUpdate | null {
  const result = LibraryTrimUpdateSchema.safeParse(value)
  return result.success ? result.data : null
}
