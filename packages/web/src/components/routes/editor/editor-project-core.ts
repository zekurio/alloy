/**
 * Core types and read-only helpers of the multitrack project model. A
 * project is a stack of tracks (index 0 renders topmost and wins playback
 * priority) holding clips that are fully decoupled from the recorded
 * captures: each clip references a media source by id and plays one source
 * range at one timeline position.
 *
 * Edit operations live in `editor-project`, transition logic in
 * `editor-transitions`; everything here is pure and side-effect free.
 */

import {
  DEFAULT_EDITOR_FILTER_ID,
  type EditorFilterId,
  normalizeEditorFilterId,
} from "./editor-filters"
import {
  DEFAULT_EDITOR_TRANSITION_TYPE,
  type EditorTransitionType,
  normalizeEditorTransitionType,
} from "./editor-transition-presets"

/** A piece of media clips can reference: a local capture or an uploaded clip. */
export interface EditorMediaSource {
  id: string
  label: string
  mediaUrl: string
  durationMs: number
  width: number | null
  height: number | null
  /** True when the media streams from the server (an uploaded clip). */
  cloud?: boolean
}

export interface TimelineClip {
  id: string
  trackId: string
  sourceId: string
  /** Denormalized from the source so trim clamps don't need a lookup. */
  sourceDurationMs: number
  /** Source-media range this clip plays. */
  sourceStartMs: number
  sourceEndMs: number
  /** Timeline position of the clip's first frame. */
  startMs: number
  label: string
}

export interface TimelineTrack {
  id: string
  label: string
}

export type TransitionType = EditorTransitionType

/**
 * A transition bridging two adjacent clips on the same track. It lives in
 * the window `[cut - durationMs, cut]` (the tail of the left clip). Without a
 * transition, boundaries are hard cuts. Transitions only stay valid while
 * their clips remain adjacent; edits that separate the pair drop them.
 */
export interface ClipTransition {
  id: string
  type: TransitionType
  leftClipId: string
  rightClipId: string
  durationMs: number
}

export interface EditorProject {
  /** Index 0 is the topmost track (highest playback priority). */
  tracks: TimelineTrack[]
  clips: TimelineClip[]
  transitions: ClipTransition[]
  /** Global visual filter applied to preview and rendered exports. */
  filterId?: EditorFilterId
  /** Default transition used when adding new junction effects. */
  transitionType?: EditorTransitionType
}

/** Smallest clip an edit operation may produce. */
export const MIN_CLIP_MS = 100
export const MIN_TRANSITION_MS = 100
export const DEFAULT_TRANSITION_MS = 500
export const DEFAULT_PROJECT_FILTER_ID = DEFAULT_EDITOR_FILTER_ID
export const DEFAULT_PROJECT_TRANSITION_TYPE = DEFAULT_EDITOR_TRANSITION_TYPE

let idCounter = 0
export function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

export function clipDurationMs(clip: TimelineClip): number {
  return Math.max(0, clip.sourceEndMs - clip.sourceStartMs)
}

export function clipEndMs(clip: TimelineClip): number {
  return clip.startMs + clipDurationMs(clip)
}

export function projectDurationMs(project: EditorProject): number {
  return project.clips.reduce((max, clip) => Math.max(max, clipEndMs(clip)), 0)
}

export function projectFilterId(project: EditorProject): EditorFilterId {
  return normalizeEditorFilterId(project.filterId)
}

export function projectTransitionType(
  project: EditorProject,
): EditorTransitionType {
  return normalizeEditorTransitionType(project.transitionType)
}

export function findClip(
  project: EditorProject,
  clipId: string,
): TimelineClip | null {
  return project.clips.find((clip) => clip.id === clipId) ?? null
}

/** Clips on one track in timeline order, optionally excluding one id. */
export function trackClips(
  project: EditorProject,
  trackId: string,
  excludeClipId?: string,
): TimelineClip[] {
  return project.clips
    .filter((clip) => clip.trackId === trackId && clip.id !== excludeClipId)
    .sort((a, b) => a.startMs - b.startMs)
}

/**
 * The clip the preview should show at a timeline position: tracks are
 * scanned top (index 0) to bottom, so an overlapping clip on a higher
 * track hides the ones below.
 */
export function clipAtTimelineMs(
  project: EditorProject,
  timelineMs: number,
): TimelineClip | null {
  for (const track of project.tracks) {
    const clip = project.clips.find(
      (entry) =>
        entry.trackId === track.id &&
        timelineMs >= entry.startMs &&
        timelineMs < clipEndMs(entry),
    )
    if (clip) return clip
  }
  return null
}
