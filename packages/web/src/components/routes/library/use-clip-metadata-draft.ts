import type { GameRow, UserSearchResult } from "@alloy/api"
import { useState } from "react"

import {
  CLIP_DESCRIPTION_MAX,
  normalizeClipDescription,
  normalizeClipTitle,
} from "@/lib/clip-fields"

import { sameIdSet } from "./library-metadata"

// The four clip editors (desktop publish, server clip dialog, web upload, and
// the metadata sheet) all drive the same title/description/game/mentions/tags
// form. Tags are canonical `string[]` here to match ClipMetadataEditor; callers
// that persist the desktop store's space-separated string convert at the edge.
export interface ClipMetadataDraftValues {
  title: string
  description: string
  game: GameRow | null
  mentions: UserSearchResult[]
  tags: string[]
}

// Only the fields needed to tell a draft apart from what's saved. Callers whose
// saved snapshot lives elsewhere (desktop store, query cache) pass it here so
// dirty tracking follows the real source of truth without a shadow copy.
export interface ClipMetadataBaseline {
  title: string
  description: string
  gameId: string | null
  mentionIds: string[]
  tags: string[]
}

/**
 * Owns the clip-metadata draft: the editable fields plus the normalized values,
 * validation, and per-field dirty tracking every editor recomputes by hand.
 *
 * `initial` seeds the fields once; editors remount per clip (keyed by id), so a
 * new clip re-seeds naturally without a reset effect. `baseline` is read every
 * render for dirty tracking — omit it for the upload flow, which has nothing to
 * compare against and only needs the normalized values and validation.
 */
export function useClipMetadataDraft(
  initial: ClipMetadataDraftValues,
  baseline?: ClipMetadataBaseline,
) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [game, setGame] = useState(initial.game)
  const [mentions, setMentions] = useState(initial.mentions)
  const [tags, setTags] = useState(initial.tags)

  const normalizedTitle = normalizeClipTitle(title)
  const normalizedDescription = normalizeClipDescription(description)
  const mentionIds = mentions.map((mention) => mention.id)

  const titleInvalid = normalizedTitle.length === 0
  const descriptionInvalid = normalizedDescription.length > CLIP_DESCRIPTION_MAX

  // An empty title is invalid rather than a savable change: excluding it keeps
  // "dirty" meaning "has pending edits", matching every editor's save guard.
  const titleChanged =
    baseline !== undefined &&
    normalizedTitle.length > 0 &&
    normalizedTitle !== normalizeClipTitle(baseline.title)
  const descriptionChanged =
    baseline !== undefined &&
    normalizedDescription !== normalizeClipDescription(baseline.description)
  const gameChanged =
    baseline !== undefined && (game?.id ?? null) !== baseline.gameId
  const mentionsChanged =
    baseline !== undefined && !sameIdSet(mentionIds, baseline.mentionIds)
  const tagsChanged = baseline !== undefined && !sameIdSet(tags, baseline.tags)
  const dirty =
    titleChanged ||
    descriptionChanged ||
    gameChanged ||
    mentionsChanged ||
    tagsChanged

  return {
    title,
    setTitle,
    description,
    setDescription,
    game,
    setGame,
    mentions,
    setMentions,
    tags,
    setTags,
    normalizedTitle,
    normalizedDescription,
    mentionIds,
    titleInvalid,
    descriptionInvalid,
    titleChanged,
    descriptionChanged,
    gameChanged,
    mentionsChanged,
    tagsChanged,
    dirty,
  }
}
