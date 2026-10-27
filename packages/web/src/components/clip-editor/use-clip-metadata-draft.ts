import type { GameRow, UserSearchResult } from "@alloy/api"
import { useForm, useStore } from "@tanstack/react-form"
import { useMemo } from "react"

import {
  CLIP_DESCRIPTION_MAX,
  normalizeClipDescription,
  normalizeClipTitle,
} from "@/lib/clip-fields"

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
 * The fields live in a TanStack form seeded from `initial`; editors remount per
 * clip (keyed by id), so a new clip re-seeds naturally without a reset effect.
 * The form adopts a changed `initial` only while nothing is touched, and
 * compares it deeply, so callers may rebuild `initial` every render. `baseline`
 * is read every render for dirty tracking — omit it for the upload flow, which
 * has nothing to compare against and only needs the normalized values and
 * validation.
 */
export function useClipMetadataDraft(
  initial: ClipMetadataDraftValues,
  baseline?: ClipMetadataBaseline,
) {
  const form = useForm({ defaultValues: initial })
  const values = useStore(form.store, (state) => state.values)
  const gameTouched = useStore(
    form.store,
    (state) => state.fieldMeta.game?.isTouched ?? false,
  )
  const { title, description, mentions, tags } = values
  // A game the user hasn't picked keeps following `initial` after other edits,
  // so a capture's game lookup that resolves mid-edit still lands. Matching by
  // id keeps the value referentially stable, which the game combobox needs.
  const game =
    gameTouched || (values.game?.id ?? null) === (initial.game?.id ?? null)
      ? values.game
      : initial.game
  const setters = useMemo(
    () => ({
      setTitle: (value: string) => form.setFieldValue("title", value),
      setDescription: (value: string) =>
        form.setFieldValue("description", value),
      setGame: (value: GameRow | null) => form.setFieldValue("game", value),
      setMentions: (value: UserSearchResult[]) =>
        form.setFieldValue("mentions", value),
      setTags: (value: string[]) => form.setFieldValue("tags", value),
    }),
    [form],
  )

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
    ...setters,
    title,
    description,
    game,
    mentions,
    tags,
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

export type ClipMetadataDraft = ReturnType<typeof useClipMetadataDraft>

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}
