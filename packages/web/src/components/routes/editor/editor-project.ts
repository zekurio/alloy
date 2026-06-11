/**
 * Project model for the multitrack editor. A project is a stack of tracks
 * (index 0 renders topmost and wins playback priority) holding clips that
 * are fully decoupled from the recorded captures: each clip references a
 * media source by id and plays one source range at one timeline position.
 * All helpers are pure so the page can keep snapshots in undo history and
 * the timeline component can stay dumb.
 *
 * Invariant: clips on the same track never overlap in timeline time —
 * placements resolve into the nearest free gap — but clips on different
 * tracks may overlap freely.
 */

/** A piece of media clips can reference: a local capture or an uploaded clip. */
export interface EditorMediaSource {
  id: string
  label: string
  mediaUrl: string
  /** Evenly spaced filmstrip frames across the whole source. */
  frames: string[]
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

export type TransitionType = "crossfade"

/**
 * A transition bridging two adjacent clips on the same track. It lives in
 * the window `[cut - durationMs, cut]` (the tail of the left clip): the
 * right clip's first frame fades in over the left clip's ending, and the
 * left clip's audio ramps out. Without a transition, boundaries are hard
 * cuts. Transitions only stay valid while their clips remain adjacent —
 * edits that separate the pair drop them (see `pruneTransitions`).
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
}

/** Smallest clip an edit operation may produce. */
export const MIN_CLIP_MS = 100
export const MIN_TRANSITION_MS = 100
export const DEFAULT_TRANSITION_MS = 500
/** Clip edges this close in timeline time count as one junction. */
const JUNCTION_TOLERANCE_MS = 1

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

export function newProject(): EditorProject {
  return {
    tracks: [
      { id: nextId("track"), label: "Track 1" },
      { id: nextId("track"), label: "Track 2" },
      { id: nextId("track"), label: "Track 3" },
    ],
    clips: [],
    transitions: [],
  }
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

export function projectsEqual(a: EditorProject, b: EditorProject): boolean {
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

/** Adds an empty track above the existing ones (new material overlays). */
export function addTrack(project: EditorProject): EditorProject {
  const track: TimelineTrack = {
    id: nextId("track"),
    label: `Track ${project.tracks.length + 1}`,
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

/* ─── Transitions ──────────────────────────────────────────────────── */

/** True when `right` starts where `left` ends, on the same track. */
export function clipsAdjacent(
  left: TimelineClip,
  right: TimelineClip,
): boolean {
  return (
    left.trackId === right.trackId &&
    Math.abs(clipEndMs(left) - right.startMs) <= JUNCTION_TOLERANCE_MS
  )
}

/** Adjacent clip pairs (junctions) on one track, in timeline order. */
export function trackJunctions(
  project: EditorProject,
  trackId: string,
): Array<{ left: TimelineClip; right: TimelineClip }> {
  const clips = trackClips(project, trackId)
  const junctions: Array<{ left: TimelineClip; right: TimelineClip }> = []
  for (let i = 0; i + 1 < clips.length; i++) {
    if (clipsAdjacent(clips[i], clips[i + 1])) {
      junctions.push({ left: clips[i], right: clips[i + 1] })
    }
  }
  return junctions
}

export function transitionBetween(
  project: EditorProject,
  leftClipId: string,
  rightClipId: string,
): ClipTransition | null {
  return (
    project.transitions.find(
      (transition) =>
        transition.leftClipId === leftClipId &&
        transition.rightClipId === rightClipId,
    ) ?? null
  )
}

/** Longest transition the junction's clips can carry. */
function maxTransitionMs(left: TimelineClip, right: TimelineClip): number {
  return Math.min(clipDurationMs(left), clipDurationMs(right))
}

/**
 * How much lead-in the right clip can actually play during a crossfade:
 * its trimmed-away source material before the in-point. During the window
 * the right side plays `[sourceStart - preRoll, sourceStart)` and lands on
 * its in-point exactly at the cut, so playback is continuous. A clip with
 * no leading handle falls back to holding its first frame.
 */
export function transitionPreRollMs(
  transition: ClipTransition,
  right: TimelineClip,
): number {
  return Math.max(0, Math.min(transition.durationMs, right.sourceStartMs))
}

/**
 * Adds a crossfade at the junction, or removes the existing transition.
 * No-op when the clips aren't adjacent or are too short to fade over.
 */
export function toggleTransition(
  project: EditorProject,
  leftClipId: string,
  rightClipId: string,
): EditorProject {
  const existing = transitionBetween(project, leftClipId, rightClipId)
  if (existing) {
    return {
      ...project,
      transitions: project.transitions.filter(
        (transition) => transition.id !== existing.id,
      ),
    }
  }
  const left = findClip(project, leftClipId)
  const right = findClip(project, rightClipId)
  if (!left || !right || !clipsAdjacent(left, right)) return project
  const durationMs = Math.min(
    DEFAULT_TRANSITION_MS,
    maxTransitionMs(left, right),
  )
  if (durationMs < MIN_TRANSITION_MS) return project
  return {
    ...project,
    transitions: [
      ...project.transitions,
      {
        id: nextId("transition"),
        type: "crossfade",
        leftClipId,
        rightClipId,
        durationMs,
      },
    ],
  }
}

/**
 * Drops transitions whose clip pair no longer exists or stopped being
 * adjacent, and re-clamps the rest into their clips' lengths. Every edit
 * that can move or shrink clips funnels through this.
 */
export function pruneTransitions(project: EditorProject): EditorProject {
  let changed = false
  const transitions: ClipTransition[] = []
  for (const transition of project.transitions) {
    const left = findClip(project, transition.leftClipId)
    const right = findClip(project, transition.rightClipId)
    if (!left || !right || !clipsAdjacent(left, right)) {
      changed = true
      continue
    }
    const durationMs = Math.min(
      transition.durationMs,
      maxTransitionMs(left, right),
    )
    if (durationMs < MIN_TRANSITION_MS) {
      changed = true
      continue
    }
    if (durationMs !== transition.durationMs) {
      changed = true
      transitions.push({ ...transition, durationMs })
    } else {
      transitions.push(transition)
    }
  }
  return changed ? { ...project, transitions } : project
}

export interface ActiveTransition {
  transition: ClipTransition
  left: TimelineClip
  right: TimelineClip
  /** Timeline position of the cut (= the right clip's start). */
  cutMs: number
  /** 0 at the window start, 1 at the cut. */
  progress: number
}

/**
 * The transition in effect at a timeline position, if its window
 * `[cut - duration, cut)` covers it and its left clip is actually the
 * visible clip there (a higher track overlaying the junction wins).
 */
export function activeTransitionAt(
  project: EditorProject,
  timelineMs: number,
): ActiveTransition | null {
  for (const transition of project.transitions) {
    const left = findClip(project, transition.leftClipId)
    const right = findClip(project, transition.rightClipId)
    if (!left || !right) continue
    const cutMs = right.startMs
    const fromMs = cutMs - transition.durationMs
    if (timelineMs < fromMs || timelineMs >= cutMs) continue
    if (clipAtTimelineMs(project, timelineMs) !== left) continue
    return {
      transition,
      left,
      right,
      cutMs,
      progress: (timelineMs - fromMs) / transition.durationMs,
    }
  }
  return null
}
