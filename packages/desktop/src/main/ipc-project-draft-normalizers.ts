import {
  RECORDING_LIBRARY_PROJECT_FILTER_IDS,
  RECORDING_LIBRARY_PROJECT_TRANSITION_TYPES,
  type RecordingLibraryProjectFilterId,
  type RecordingLibraryProjectTransitionType,
} from "@alloy/contracts"

import type {
  RecordingLibraryProject,
  RecordingLibraryProjectClip,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectTrack,
  RecordingLibraryProjectTransition,
} from "@/shared/ipc"

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
  return {
    tracks,
    clips,
    transitions,
    filterId: normalizeProjectDraftFilterId(record.filterId),
    transitionType: normalizeProjectDraftTransitionType(record.transitionType),
  }
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
  const type = normalizeProjectDraftTransitionType(record.type)
  if (
    !id ||
    !leftClipId ||
    !rightClipId ||
    !clipIds.has(leftClipId) ||
    !clipIds.has(rightClipId)
  ) {
    return null
  }
  return {
    id,
    type,
    leftClipId,
    rightClipId,
    durationMs: normalizeProjectDraftMs(record.durationMs),
  }
}

function normalizeProjectDraftFilterId(
  value: unknown,
): RecordingLibraryProjectFilterId {
  return RECORDING_LIBRARY_PROJECT_FILTER_IDS.includes(
    value as RecordingLibraryProjectFilterId,
  )
    ? (value as RecordingLibraryProjectFilterId)
    : "none"
}

function normalizeProjectDraftTransitionType(
  value: unknown,
): RecordingLibraryProjectTransitionType {
  return RECORDING_LIBRARY_PROJECT_TRANSITION_TYPES.includes(
    value as RecordingLibraryProjectTransitionType,
  )
    ? (value as RecordingLibraryProjectTransitionType)
    : "crossfade"
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
