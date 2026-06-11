import {
  CLIP_PRIVACY,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  type ClipPrivacy,
  type RecordingNotificationSoundEvent,
} from "alloy-contracts"

import type {
  RecordingCaptureMention,
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
  RecordingLibraryImportRequest,
  RecordingLibraryMetaPatch,
  RecordingLibraryProject,
  RecordingLibraryProjectClip,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectTrack,
  RecordingLibraryProjectTransition,
} from "../shared/ipc"

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

/** Hard cap on imported render size (a structured-clone copy in memory). */
const IMPORT_MAX_BYTES = 4 * 1024 * 1024 * 1024
const IMPORT_FILE_NAME_MAX = 120

export function normalizeLibraryImportRequest(
  value: unknown,
): RecordingLibraryImportRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (!(record.data instanceof Uint8Array)) return null
  if (
    record.data.byteLength === 0 ||
    record.data.byteLength > IMPORT_MAX_BYTES
  ) {
    return null
  }
  if (typeof record.fileName !== "string") return null
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, record.durationMs)
      : 0
  return {
    fileName: record.fileName.slice(0, IMPORT_FILE_NAME_MAX),
    data: record.data,
    durationMs,
    width: normalizeDimension(record.width),
    height: normalizeDimension(record.height),
  }
}

const PROJECT_DRAFT_TITLE_MAX = 200
const PROJECT_DRAFT_ID_MAX = 120
const PROJECT_DRAFT_LABEL_MAX = 200
const PROJECT_DRAFT_TRACKS_MAX = 50
const PROJECT_DRAFT_CLIPS_MAX = 1000
const PROJECT_DRAFT_TRANSITIONS_MAX = 1000
const PROJECT_DRAFT_MAX_MS = 24 * 60 * 60 * 1000

export function normalizeProjectDraftSaveRequest(
  value: unknown,
): RecordingLibraryProjectDraftSaveRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const project = normalizeProjectDraftProject(record.project)
  if (!project) return null
  return {
    id:
      typeof record.id === "string" && record.id.length > 0
        ? record.id.slice(0, PROJECT_DRAFT_ID_MAX)
        : null,
    title:
      typeof record.title === "string"
        ? record.title.slice(0, PROJECT_DRAFT_TITLE_MAX)
        : "",
    project,
  }
}

function normalizeProjectDraftProject(
  value: unknown,
): RecordingLibraryProject | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const tracks = (Array.isArray(record.tracks) ? record.tracks : [])
    .slice(0, PROJECT_DRAFT_TRACKS_MAX)
    .map(normalizeProjectDraftTrack)
    .filter((track): track is RecordingLibraryProjectTrack => track !== null)
  if (tracks.length === 0) return null
  const trackIds = new Set(tracks.map((track) => track.id))
  const clips = (Array.isArray(record.clips) ? record.clips : [])
    .slice(0, PROJECT_DRAFT_CLIPS_MAX)
    .map((clip) => normalizeProjectDraftClip(clip, trackIds))
    .filter((clip): clip is RecordingLibraryProjectClip => clip !== null)
  const clipIds = new Set(clips.map((clip) => clip.id))
  const transitions = (
    Array.isArray(record.transitions) ? record.transitions : []
  )
    .slice(0, PROJECT_DRAFT_TRANSITIONS_MAX)
    .map((transition) => normalizeProjectDraftTransition(transition, clipIds))
    .filter(
      (transition): transition is RecordingLibraryProjectTransition =>
        transition !== null,
    )
  return { tracks, clips, transitions }
}

function normalizeProjectDraftTrack(
  value: unknown,
): RecordingLibraryProjectTrack | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  if (!id) return null
  return {
    id,
    label:
      normalizeProjectDraftString(record.label, PROJECT_DRAFT_LABEL_MAX) ||
      "Track",
  }
}

function normalizeProjectDraftClip(
  value: unknown,
  trackIds: Set<string>,
): RecordingLibraryProjectClip | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  const trackId = normalizeProjectDraftString(
    record.trackId,
    PROJECT_DRAFT_ID_MAX,
  )
  const sourceId = normalizeProjectDraftString(
    record.sourceId,
    PROJECT_DRAFT_ID_MAX,
  )
  if (!id || !trackId || !sourceId || !trackIds.has(trackId)) return null

  const sourceDurationMs = normalizeProjectDraftMs(record.sourceDurationMs)
  const sourceStartMs = Math.min(
    normalizeProjectDraftMs(record.sourceStartMs),
    sourceDurationMs,
  )
  const sourceEndMs = Math.max(
    sourceStartMs,
    Math.min(normalizeProjectDraftMs(record.sourceEndMs), sourceDurationMs),
  )
  return {
    id,
    trackId,
    sourceId,
    sourceDurationMs,
    sourceStartMs,
    sourceEndMs,
    startMs: normalizeProjectDraftMs(record.startMs),
    label:
      normalizeProjectDraftString(record.label, PROJECT_DRAFT_LABEL_MAX) ||
      "Clip",
  }
}

function normalizeProjectDraftTransition(
  value: unknown,
  clipIds: Set<string>,
): RecordingLibraryProjectTransition | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  const leftClipId = normalizeProjectDraftString(
    record.leftClipId,
    PROJECT_DRAFT_ID_MAX,
  )
  const rightClipId = normalizeProjectDraftString(
    record.rightClipId,
    PROJECT_DRAFT_ID_MAX,
  )
  if (
    !id ||
    record.type !== "crossfade" ||
    !leftClipId ||
    !rightClipId ||
    !clipIds.has(leftClipId) ||
    !clipIds.has(rightClipId)
  ) {
    return null
  }
  return {
    id,
    type: "crossfade",
    leftClipId,
    rightClipId,
    durationMs: normalizeProjectDraftMs(record.durationMs),
  }
}

function normalizeProjectDraftString(
  value: unknown,
  maxLength: number,
): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeProjectDraftMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(PROJECT_DRAFT_MAX_MS, Math.max(0, Math.round(value)))
    : 0
}

function normalizeDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

const META_TITLE_MAX = 200
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
  } else if (CLIP_PRIVACY.includes(record.privacy as ClipPrivacy)) {
    patch.privacy = record.privacy as ClipPrivacy
  }
  return patch
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
    displayUsername:
      typeof record.displayUsername === "string" ? record.displayUsername : "",
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
