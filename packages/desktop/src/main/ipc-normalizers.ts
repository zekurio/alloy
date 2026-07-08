import {
  CLIP_PRIVACY,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  type ClipPrivacy,
  type RecordingNotificationSoundEvent,
} from "@alloy/contracts"

import type {
  RecordingCaptureMention,
  RecordingLibraryCommitStagedImportRequest,
  RecordingLibraryDownloadRequest,
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
  RecordingLibraryMetaPatch,
} from "@/shared/ipc"

export function isNotificationSoundEvent(
  value: unknown,
): value is RecordingNotificationSoundEvent {
  return RECORDING_NOTIFICATION_SOUND_EVENTS.includes(
    value as RecordingNotificationSoundEvent,
  )
}

export function normalizeActionRequest(value: unknown): {
  requestedAtUnixMs: number
} {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    requestedAtUnixMs: normalizeUnixMs(record.requestedAtUnixMs),
  }
}

export function normalizeSaveReplayClipRequest(value: unknown): {
  requestedAtUnixMs: number
  durationSeconds: number
} {
  const request = normalizeActionRequest(value)
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    ...request,
    durationSeconds: normalizeDurationSeconds(record.durationSeconds),
  }
}

const EXPORT_SEGMENTS_MAX = 100

export function normalizeLibraryExportRequest(
  value: unknown,
): RecordingLibraryExportRequest {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const segments: RecordingLibraryExportSegment[] = (
    Array.isArray(record.segments) ? record.segments : []
  )
    .slice(0, EXPORT_SEGMENTS_MAX)
    .flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return []
      const segment = entry as Record<string, unknown>
      return [
        {
          startMs: normalizeTrimMs(segment.startMs),
          endMs: normalizeTrimMs(segment.endMs),
        },
      ]
    })
  return {
    id: typeof record.id === "string" ? record.id : "",
    segments,
  }
}

const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024

const COMMIT_STAGED_IMPORT_ID_MAX = 128
const COMMIT_STAGED_IMPORT_TITLE_MAX = 200
const COMMIT_STAGED_IMPORT_GAME_NAME_MAX = 200
const COMMIT_STAGED_IMPORT_GAME_ICON_URL_MAX = 2000

export function normalizeLibraryCommitStagedImportRequest(
  value: unknown,
): RecordingLibraryCommitStagedImportRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > COMMIT_STAGED_IMPORT_ID_MAX
  ) {
    return null
  }
  if (typeof record.title !== "string") return null
  if (typeof record.gameName !== "string") return null

  const title = record.title.trim().slice(0, COMMIT_STAGED_IMPORT_TITLE_MAX)
  const gameName = record.gameName
    .trim()
    .slice(0, COMMIT_STAGED_IMPORT_GAME_NAME_MAX)
  if (title.length === 0 || gameName.length === 0) return null

  return {
    id: record.id,
    title,
    gameName,
    gameIconUrl:
      typeof record.gameIconUrl === "string"
        ? record.gameIconUrl.slice(0, COMMIT_STAGED_IMPORT_GAME_ICON_URL_MAX)
        : null,
  }
}

export function normalizeLibraryThumbnailSaveRequest(
  value: unknown,
): { id: string; data: Uint8Array } | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null
  if (!(record.data instanceof Uint8Array)) return null
  if (
    record.data.byteLength === 0 ||
    record.data.byteLength > THUMBNAIL_MAX_BYTES
  ) {
    return null
  }
  return { id: record.id, data: record.data }
}

const DOWNLOAD_TITLE_MAX = 200
const DOWNLOAD_ID_MAX = 64
const DOWNLOAD_URL_MAX = 2000
const DOWNLOAD_GAME_NAME_MAX = 200
const DOWNLOAD_CONTENT_TYPE_MAX = 100

/**
 * Returns a sanitized clip download request, or null when it lacks a usable
 * clip id or media URL. The URL's origin is checked against the connected
 * server by the IPC handler, not here.
 */
export function normalizeLibraryDownloadRequest(
  value: unknown,
): RecordingLibraryDownloadRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.clipId !== "string" ||
    record.clipId.length === 0 ||
    record.clipId.length > DOWNLOAD_ID_MAX
  ) {
    return null
  }
  if (
    typeof record.mediaUrl !== "string" ||
    record.mediaUrl.length === 0 ||
    record.mediaUrl.length > DOWNLOAD_URL_MAX
  ) {
    return null
  }
  const title =
    typeof record.title === "string"
      ? record.title.trim().slice(0, DOWNLOAD_TITLE_MAX)
      : ""
  return {
    clipId: record.clipId,
    title: title || "Clip",
    mediaUrl: record.mediaUrl,
    contentType:
      typeof record.contentType === "string"
        ? record.contentType.slice(0, DOWNLOAD_CONTENT_TYPE_MAX)
        : null,
    sizeBytes: normalizePositiveInteger(record.sizeBytes),
    durationMs: normalizePositiveInteger(record.durationMs),
    width: normalizeDimension(record.width),
    height: normalizeDimension(record.height),
    gameName:
      typeof record.gameName === "string"
        ? record.gameName.slice(0, DOWNLOAD_GAME_NAME_MAX)
        : null,
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function normalizeDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

const META_TITLE_MAX = 200
const META_GAME_NAME_MAX = 200
const META_GAME_ICON_URL_MAX = 2000
const META_DESCRIPTION_MAX = 4000
const META_TAGS_MAX = 500
const META_MENTIONS_MAX = 50

/**
 * Returns a sanitized draft-metadata patch, or null when the request carries
 * no usable id. Unknown fields are dropped; present fields are length-capped
 * so a misbehaving page can't bloat the manifest.
 */
export function normalizeLibraryMetaPatch(
  value: unknown,
): RecordingLibraryMetaPatch | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null

  const patch: RecordingLibraryMetaPatch = { id: record.id }
  if (typeof record.title === "string") {
    const title = record.title.trim().slice(0, META_TITLE_MAX)
    if (title.length > 0) patch.title = title
  }
  if (typeof record.gameName === "string" || record.gameName === null) {
    const gameName =
      record.gameName?.trim().slice(0, META_GAME_NAME_MAX) ?? null
    patch.gameName = gameName && gameName.length > 0 ? gameName : null
  }
  if (typeof record.gameIconUrl === "string" || record.gameIconUrl === null) {
    patch.gameIconUrl =
      record.gameIconUrl?.slice(0, META_GAME_ICON_URL_MAX) ?? null
  }
  if (typeof record.description === "string" || record.description === null) {
    patch.description =
      record.description?.slice(0, META_DESCRIPTION_MAX) ?? null
  }
  if (typeof record.tags === "string" || record.tags === null) {
    patch.tags = record.tags?.slice(0, META_TAGS_MAX) ?? null
  }
  if (Array.isArray(record.mentions)) {
    patch.mentions = record.mentions
      .slice(0, META_MENTIONS_MAX)
      .map(normalizeCaptureMention)
      .filter((mention): mention is RecordingCaptureMention => mention !== null)
  }
  if (record.privacy === null) {
    patch.privacy = null
  }
  if (isClipPrivacy(record.privacy)) patch.privacy = record.privacy
  if (record.uploadedClipId === null) {
    patch.uploadedClipId = null
  }
  if (
    typeof record.uploadedClipId === "string" &&
    record.uploadedClipId.length > 0 &&
    record.uploadedClipId.length <= 64
  ) {
    patch.uploadedClipId = record.uploadedClipId
  }
  return patch
}

function isClipPrivacy(value: unknown): value is ClipPrivacy {
  return CLIP_PRIVACY.includes(value as ClipPrivacy)
}

function normalizeCaptureMention(
  value: unknown,
): RecordingCaptureMention | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null
  return {
    id: record.id,
    username: typeof record.username === "string" ? record.username : "",
    image: typeof record.image === "string" ? record.image : null,
  }
}

function normalizeTrimMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
}

function normalizeUnixMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : Date.now()
}

function normalizeDurationSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(600, Math.max(15, Math.round(value)))
    : 90
}
