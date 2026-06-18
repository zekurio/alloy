import { t as tx } from "@alloy/i18n"
/**
 * Edit operations of the multitrack project model. All helpers are pure so
 * the page can keep snapshots in undo history and the timeline component
 * can stay dumb. Types and read-only helpers live in `editor-project-core`,
 * transition logic in `editor-transitions`; both are re-exported here so
 * consumers keep a single import path.
 *
 * Invariant: clips on the same track never overlap in timeline time —
 * placements resolve into the nearest free gap — but clips on different
 * tracks may overlap freely.
 */

import {
  clipDurationMs,
  clipEndMs,
  DEFAULT_PROJECT_FILTER_ID,
  DEFAULT_PROJECT_TRANSITION_TYPE,
  type EditorMediaSource,
  type EditorProject,
  findClip,
  MIN_CLIP_MS,
  nextId,
  projectFilterId,
  projectTransitionType,
  type TimelineClip,
  type TimelineTrack,
  trackClips,
} from "./editor-project-core"
import { pruneTransitions } from "./editor-transitions"

export {
  clipAtTimelineMs,
  clipDurationMs,
  clipEndMs,
  type ClipTransition,
  DEFAULT_TRANSITION_MS,
  DEFAULT_PROJECT_FILTER_ID,
  DEFAULT_PROJECT_TRANSITION_TYPE,
  type EditorMediaSource,
  type EditorProject,
  findClip,
  MIN_CLIP_MS,
  MIN_TRANSITION_MS,
  projectFilterId,
  projectTransitionType,
  projectDurationMs,
  type TimelineClip,
  type TimelineTrack,
  trackClips,
  type TransitionType,
} from "./editor-project-core"
export {
  type ActiveTransition,
  activeTransitionAt,
  clipsAdjacent,
  pruneTransitions,
  toggleTransition,
  trackJunctions,
  transitionBetween,
  transitionPreRollMs,
} from "./editor-transitions"

export function newProject(): EditorProject {
  return {
    tracks: [
      { id: nextId("track"), label: tx("Track 1") },
      { id: nextId("track"), label: tx("Track 2") },
      { id: nextId("track"), label: tx("Track 3") },
    ],
    clips: [],
    transitions: [],
    filterId: DEFAULT_PROJECT_FILTER_ID,
    transitionType: DEFAULT_PROJECT_TRANSITION_TYPE,
  }
}

export function projectsEqual(a: EditorProject, b: EditorProject): boolean {
  if (projectFilterId(a) !== projectFilterId(b)) return false
  if (projectTransitionType(a) !== projectTransitionType(b)) return false
  if (a.tracks.length !== b.tracks.length) return false
  if (a.clips.length !== b.clips.length) return false
  if (a.transitions.length !== b.transitions.length) return false
  if (a.tracks.some((track, i) => track.id !== b.tracks[i].id)) return false
  if (
    a.transitions.some((transition, i) => {
      const other = b.transitions[i]
      return (
        transition.id !== other.id ||
        transition.type !== other.type ||
        transition.leftClipId !== other.leftClipId ||
        transition.rightClipId !== other.rightClipId ||
        transition.durationMs !== other.durationMs
      )
    })
  ) {
    return false
  }
  return a.clips.every((clip, i) => {
    const other = b.clips[i]
    return (
      clip.id === other.id &&
      clip.trackId === other.trackId &&
      clip.sourceStartMs === other.sourceStartMs &&
      clip.sourceEndMs === other.sourceEndMs &&
      clip.startMs === other.startMs
    )
  })
}

/**
 * Finds the start position closest to `desiredMs` where a clip of
 * `durationMs` fits on a track without overlapping `others`. Works on the
 * track's free gaps, so the result is deterministic (no push cascades).
 */
export function resolveTrackPlacement(
  others: TimelineClip[],
  durationMs: number,
  desiredMs: number,
): number {
  const desired = Math.max(0, Math.round(desiredMs))
  const sorted = [...others].sort((a, b) => a.startMs - b.startMs)

  // Free gaps: before the first clip, between clips, after the last.
  const gaps: Array<{ fromMs: number; toMs: number }> = []
  let cursor = 0
  for (const clip of sorted) {
    if (clip.startMs - cursor >= durationMs) {
      gaps.push({ fromMs: cursor, toMs: clip.startMs - durationMs })
    }
    cursor = Math.max(cursor, clipEndMs(clip))
  }
  gaps.push({ fromMs: cursor, toMs: Number.POSITIVE_INFINITY })

  let best = cursor
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const candidate = Math.min(Math.max(desired, gap.fromMs), gap.toMs)
    const distance = Math.abs(candidate - desired)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/** Adds a clip playing the full source, placed near `atMs` on `trackId`. */
export function addClip(
  project: EditorProject,
  source: EditorMediaSource,
  trackId: string,
  atMs: number,
): { project: EditorProject; clipId: string } {
  const durationMs = Math.max(MIN_CLIP_MS, source.durationMs)
  const startMs = resolveTrackPlacement(
    trackClips(project, trackId),
    durationMs,
    atMs,
  )
  const clip: TimelineClip = {
    id: nextId("clip"),
    trackId,
    sourceId: source.id,
    sourceDurationMs: source.durationMs,
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    startMs,
    label: source.label,
  }
  return {
    project: { ...project, clips: [...project.clips, clip] },
    clipId: clip.id,
  }
}

/** Moves a clip to a (possibly different) track near `desiredStartMs`. */
export function moveClip(
  project: EditorProject,
  clipId: string,
  trackId: string,
  desiredStartMs: number,
): EditorProject {
  const clip = findClip(project, clipId)
  if (!clip || !project.tracks.some((track) => track.id === trackId)) {
    return project
  }
  const startMs = resolveTrackPlacement(
    trackClips(project, trackId, clipId),
    clipDurationMs(clip),
    desiredStartMs,
  )
  if (startMs === clip.startMs && trackId === clip.trackId) return project
  return pruneTransitions(
    withClip(project, clipId, { ...clip, trackId, startMs }),
  )
}

/**
 * Drags a clip's left edge to `timelineMs`: the clip's in-point shifts by
 * the same amount, so the material under the rest of the clip stays put.
 * Clamped against the source bounds, the clip's minimum length, and the
 * previous clip on the track.
 */
export function trimClipStart(
  project: EditorProject,
  clipId: string,
  timelineMs: number,
): EditorProject {
  const clip = findClip(project, clipId)
  if (!clip) return project
  const previous = trackClips(project, clip.trackId, clipId).findLast(
    (other) => other.startMs < clip.startMs,
  )
  const minStart = Math.max(
    previous ? clipEndMs(previous) : 0,
    clip.startMs - clip.sourceStartMs,
  )
  const maxStart = clipEndMs(clip) - MIN_CLIP_MS
  const startMs = Math.round(Math.min(maxStart, Math.max(minStart, timelineMs)))
  const delta = startMs - clip.startMs
  if (delta === 0) return project
  return pruneTransitions(
    withClip(project, clipId, {
      ...clip,
      startMs,
      sourceStartMs: clip.sourceStartMs + delta,
    }),
  )
}

/** Drags a clip's right edge to `timelineMs` (mirror of the start trim). */
export function trimClipEnd(
  project: EditorProject,
  clipId: string,
  timelineMs: number,
): EditorProject {
  const clip = findClip(project, clipId)
  if (!clip) return project
  const next = trackClips(project, clip.trackId, clipId).find(
    (other) => other.startMs >= clipEndMs(clip),
  )
  const maxEnd = Math.min(
    next ? next.startMs : Number.POSITIVE_INFINITY,
    clip.startMs + (clip.sourceDurationMs - clip.sourceStartMs),
  )
  const minEnd = clip.startMs + MIN_CLIP_MS
  const endMs = Math.round(Math.min(maxEnd, Math.max(minEnd, timelineMs)))
  const sourceEndMs = clip.sourceStartMs + (endMs - clip.startMs)
  if (sourceEndMs === clip.sourceEndMs) return project
  return pruneTransitions(withClip(project, clipId, { ...clip, sourceEndMs }))
}

/**
 * Splits the clip under `timelineMs` into two adjacent clips. Returns null
 * when the position misses every clip or a piece would fall under
 * `MIN_CLIP_MS`.
 */
export function splitClipAt(
  project: EditorProject,
  clipId: string,
  timelineMs: number,
): { project: EditorProject; rightClipId: string } | null {
  const clip = findClip(project, clipId)
  if (!clip) return null
  const offsetMs = Math.round(timelineMs - clip.startMs)
  if (offsetMs < MIN_CLIP_MS || clipDurationMs(clip) - offsetMs < MIN_CLIP_MS) {
    return null
  }
  const cutSourceMs = clip.sourceStartMs + offsetMs
  const right: TimelineClip = {
    ...clip,
    id: nextId("clip"),
    sourceStartMs: cutSourceMs,
    startMs: clip.startMs + offsetMs,
  }
  const clips = project.clips.flatMap((entry) =>
    entry.id === clipId
      ? [{ ...entry, sourceEndMs: cutSourceMs }, right]
      : entry,
  )
  // The junction at the original clip's end now belongs to the right piece.
  const transitions = project.transitions.map((transition) =>
    transition.leftClipId === clipId
      ? { ...transition, leftClipId: right.id }
      : transition,
  )
  return {
    project: pruneTransitions({ ...project, clips, transitions }),
    rightClipId: right.id,
  }
}

export function removeClip(
  project: EditorProject,
  clipId: string,
): EditorProject {
  if (!findClip(project, clipId)) return project
  return pruneTransitions({
    ...project,
    clips: project.clips.filter((clip) => clip.id !== clipId),
  })
}

export function setProjectFilter(
  project: EditorProject,
  filterId: EditorProject["filterId"],
): EditorProject {
  const nextFilterId = filterId ?? DEFAULT_PROJECT_FILTER_ID
  if (projectFilterId(project) === nextFilterId) return project
  return { ...project, filterId: nextFilterId }
}

export function setProjectTransitionType(
  project: EditorProject,
  transitionType: EditorProject["transitionType"],
): EditorProject {
  const nextTransitionType = transitionType ?? DEFAULT_PROJECT_TRANSITION_TYPE
  if (projectTransitionType(project) === nextTransitionType) return project
  return { ...project, transitionType: nextTransitionType }
}

/** Adds an empty track above the existing ones (new material overlays). */
export function addTrack(project: EditorProject): EditorProject {
  const track: TimelineTrack = {
    id: nextId("track"),
    label: tx("Track {number}", { number: project.tracks.length + 1 }),
  }
  return { ...project, tracks: [track, ...project.tracks] }
}

/** Removing a track moves its clips nowhere — only empty tracks can go. */
export function removeTrack(
  project: EditorProject,
  trackId: string,
): EditorProject {
  if (project.tracks.length <= 1) return project
  if (project.clips.some((clip) => clip.trackId === trackId)) return project
  return {
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
  }
}

function withClip(
  project: EditorProject,
  clipId: string,
  next: TimelineClip,
): EditorProject {
  return {
    ...project,
    clips: project.clips.map((clip) => (clip.id === clipId ? next : clip)),
  }
}
