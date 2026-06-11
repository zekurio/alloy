/**
 * Transition (crossfade) logic of the project model: junction discovery,
 * toggling, validity pruning, and resolving the transition in effect at a
 * timeline position. All helpers are pure, mirroring `editor-project`.
 */

import {
  clipAtTimelineMs,
  clipDurationMs,
  clipEndMs,
  type ClipTransition,
  DEFAULT_TRANSITION_MS,
  type EditorProject,
  findClip,
  MIN_TRANSITION_MS,
  nextId,
  type TimelineClip,
  trackClips,
} from "./editor-project-core"

/** Clip edges this close in timeline time count as one junction. */
const JUNCTION_TOLERANCE_MS = 1

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

/** The transition that fades into `clip`, if any. */
export function incomingTransitionFor(
  project: EditorProject,
  clip: TimelineClip,
): ClipTransition | null {
  return (
    project.transitions.find(
      (transition) => transition.rightClipId === clip.id,
    ) ?? null
  )
}

/** The transition that fades `clip` out, if any. */
export function outgoingTransitionFor(
  project: EditorProject,
  clip: TimelineClip,
): ClipTransition | null {
  return (
    project.transitions.find(
      (transition) => transition.leftClipId === clip.id,
    ) ?? null
  )
}

/** Crossfade lead-in available to a clip entered by a transition. */
export function incomingPreRollMs(
  project: EditorProject,
  clip: TimelineClip,
): number {
  const incoming = incomingTransitionFor(project, clip)
  return incoming ? transitionPreRollMs(incoming, clip) : 0
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
