import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import { useUpdateClipMutation } from "../lib/clip-queries"
import {
  CLIP_DESCRIPTION_MAX,
  CLIP_TITLE_MAX,
  PRIVACY_OPTIONS,
} from "../lib/clip-fields"
import type { ClipMentionRef, ClipPrivacy, ClipRow } from "../lib/clips-api"
import type { GameRow } from "../lib/games-api"
import type { UserSearchResult } from "../lib/users-api"

import { GameCombobox } from "./game-combobox"
import { MentionPicker } from "./mention-picker"

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
        onError: (err) =>
          toast.error("Couldn't save changes", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90dvh,820px)] max-w-2xl flex-col gap-0 bg-surface p-0"
        )}
      >
        <DialogHeader className="border-b border-border/70 pb-3">
          <DialogTitle>Edit clip</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-5">
            <FormField label="Title" htmlFor="clip-edit-title">
              <input
                id="clip-edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={CLIP_TITLE_MAX}
                disabled={saving}
                aria-invalid={titleInvalid}
                className={cn(
                  "w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground",
                  "placeholder:text-foreground-faint",
                  "focus-visible:border-accent-border focus-visible:outline-none"
                )}
              />
              {titleInvalid ? (
                <span className="text-xs text-destructive">
                  Title can't be empty.
                </span>
              ) : null}
            </FormField>

            <FormField label="Description" htmlFor="clip-edit-description">
              <textarea
                id="clip-edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={CLIP_DESCRIPTION_MAX}
                disabled={saving}
                placeholder="Add a description…"
                className={cn(
                  "w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground",
                  "placeholder:text-foreground-faint",
                  "focus-visible:border-accent-border focus-visible:outline-none"
                )}
              />
            </FormField>

            <FormField label="Game">
              <GameCombobox
                value={game}
                onChange={setGame}
                disabled={saving}
                allowClear={false}
                side="bottom"
              />
            </FormField>

            <FormField label="Visibility">
              <div className="grid grid-cols-3 gap-2">
                {PRIVACY_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const active = option.value === privacy
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPrivacy(option.value)}
                      disabled={saving}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs",
                        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                        active
                          ? "border-accent-border bg-accent-soft text-accent"
                          : "border-border bg-surface-raised text-foreground-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3.5" />
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </FormField>

            <FormField label="Tagged users">
              <MentionPicker
                value={mentions}
                onChange={setMentions}
                disabled={saving}
              />
            </FormField>
          </div>
        </DialogBody>

        <DialogFooter
          className={cn(
            "border-t border-border/70 bg-surface px-4 pt-3 sm:px-6",
            "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="default"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium tracking-wide text-foreground-faint uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
