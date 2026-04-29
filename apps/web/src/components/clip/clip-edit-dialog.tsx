import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@workspace/ui/components/responsive-dialog"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"

import type {
  ClipMentionRef,
  ClipPrivacy,
  ClipRow,
  GameRow,
  UserSearchResult,
} from "@workspace/api"

import { useUpdateClipMutation } from "@/lib/clip-queries"
import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"

import { ClipPrivacyPicker } from "./clip-privacy-picker"
import { LimitedInput, LimitedTextarea } from "@/components/form/limited-field"
import { GameCombobox } from "@/components/game/game-combobox"
import { MentionPicker } from "@/components/search/mention-picker"

interface ClipEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ClipRow
}

function gameRowFromRef(row: ClipRow): GameRow | null {
  const ref = row.gameRef
  if (!ref) return null
  return {
    id: ref.id,
    steamgriddbId: ref.steamgriddbId,
    name: ref.name,
    slug: ref.slug,
    releaseDate: ref.releaseDate,
    heroUrl: ref.heroUrl,
    gridUrl: ref.gridUrl,
    logoUrl: ref.logoUrl,
    iconUrl: ref.iconUrl,
  }
}

function mentionToSearchResult(ref: ClipMentionRef): UserSearchResult {
  return {
    id: ref.id,
    username: ref.username,
    displayUsername: ref.displayUsername,
    name: ref.name,
    image: ref.image,
  }
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

export function ClipEditDialog({
  open,
  onOpenChange,
  row,
}: ClipEditDialogProps) {
  const [title, setTitle] = React.useState(row.title)
  const [description, setDescription] = React.useState(row.description ?? "")
  const [privacy, setPrivacy] = React.useState<ClipPrivacy>(row.privacy)
  const [game, setGame] = React.useState<GameRow | null>(() =>
    gameRowFromRef(row)
  )
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(() =>
    (row.mentions ?? []).map(mentionToSearchResult)
  )
  const mutation = useUpdateClipMutation()

  const prevOpenRef = React.useRef(open)
  React.useEffect(() => {
    const prev = prevOpenRef.current
    prevOpenRef.current = open
    if (!prev && open) {
      setTitle(row.title)
      setDescription(row.description ?? "")
      setPrivacy(row.privacy)
      setGame(gameRowFromRef(row))
      setMentions((row.mentions ?? []).map(mentionToSearchResult))
    }
  }, [open, row])

  const saving = mutation.isPending

  const trimmedTitle = title.trim()
  const trimmedDescription = description.trim()
  const currentDescription = row.description ?? ""
  const originalMentionIds = (row.mentions ?? []).map((m) => m.id)
  const mentionIds = mentions.map((m) => m.id)

  const titleChanged = trimmedTitle !== row.title && trimmedTitle.length > 0
  const descriptionChanged = trimmedDescription !== currentDescription.trim()
  const privacyChanged = privacy !== row.privacy
  const gameChanged = (game?.id ?? null) !== (row.gameRef?.id ?? null)
  const mentionsChanged = !sameIdSet(mentionIds, originalMentionIds)

  const dirty =
    titleChanged ||
    descriptionChanged ||
    privacyChanged ||
    gameChanged ||
    mentionsChanged
  const titleInvalid = trimmedTitle.length === 0

  const handleSave = React.useCallback(() => {
    if (!dirty || titleInvalid || saving) return
    const input: Parameters<typeof mutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (privacyChanged) input.privacy = privacy
    if (gameChanged && game) input.gameId = game.id
    if (mentionsChanged) input.mentionedUserIds = mentionIds
    mutation.mutate(
      { clipId: row.id, input },
      {
        onSuccess: () => {
          toast.success("Clip updated")
          onOpenChange(false)
        },
        onError: () => toast.error("Couldn't save changes"),
      }
    )
  }, [
    dirty,
    titleInvalid,
    saving,
    titleChanged,
    trimmedTitle,
    descriptionChanged,
    trimmedDescription,
    privacyChanged,
    privacy,
    gameChanged,
    game,
    mentionsChanged,
    mentionIds,
    mutation,
    row.id,
    onOpenChange,
  ])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        variant="secondary"
        className={cn(
          "flex max-h-[min(90dvh,820px)] max-w-2xl flex-col gap-0 bg-surface p-0"
        )}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit clip</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-5">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="clip-edit-title">Title</FieldLabel>
              <LimitedInput
                id="clip-edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={CLIP_TITLE_MAX}
                disabled={saving}
                aria-invalid={titleInvalid}
              />
              {titleInvalid ? (
                <span className="text-xs text-destructive">
                  Title can't be empty.
                </span>
              ) : null}
            </Field>

            <Field className="gap-1.5">
              <FieldLabel htmlFor="clip-edit-description">
                Description
              </FieldLabel>
              <LimitedTextarea
                id="clip-edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={CLIP_DESCRIPTION_MAX}
                disabled={saving}
                placeholder="Add a description…"
                className="min-h-0"
              />
            </Field>

            <Field className="gap-1.5">
              <FieldLabel>Game</FieldLabel>
              <GameCombobox
                value={game}
                onChange={setGame}
                disabled={saving}
                allowClear={false}
                side="bottom"
              />
            </Field>

            <Field className="gap-1.5">
              <FieldLabel>Visibility</FieldLabel>
              <ClipPrivacyPicker
                value={privacy}
                onChange={setPrivacy}
                disabled={saving}
              />
            </Field>

            <Field className="gap-1.5">
              <FieldLabel>Tagged users</FieldLabel>
              <MentionPicker
                value={mentions}
                onChange={setMentions}
                disabled={saving}
              />
            </Field>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter
          className={cn(
            "px-4 pt-3 sm:px-6",
            "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="default"
            onClick={handleSave}
            disabled={!dirty || titleInvalid || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
