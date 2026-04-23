import * as React from "react"
import { TagIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import type {
  ClipMentionRef,
  ClipPrivacy,
  UserSearchResult,
} from "@workspace/api"

import { useUpdateClipMutation } from "@/lib/clip-queries"
import { PRIVACY_BY_VALUE, PRIVACY_OPTIONS } from "@/lib/clip-fields"

import { MentionPicker } from "@/components/search/mention-picker"

export function PrivacyBadgeMenu({
  clipId,
  value,
  className,
  asButton = false,
}: {
  clipId: string
  value: ClipPrivacy
  className?: string
  asButton?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  const pendingPrivacy =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.privacy
      : undefined
  const displayValue = pendingPrivacy ?? value
  const display = PRIVACY_BY_VALUE[displayValue]
  const Icon = display.icon

  const choose = (next: ClipPrivacy) => {
    setOpen(false)
    if (next === value) return
    mutation.mutate(
      { clipId, input: { privacy: next } },
      {
        onError: (err) =>
          toast.error("Couldn't update visibility", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      }
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          asButton ? (
            <Button
              variant="ghost"
              size="default"
              disabled={saving}
              className={cn(className)}
              aria-label={`Visibility: ${display.label}. Click to change.`}
            />
          ) : (
            <Badge
              variant="default"
              className={cn(
                "cursor-pointer transition-opacity hover:bg-surface-raised/80",
                saving && "opacity-60",
                className
              )}
              aria-label={`Visibility: ${display.label}. Click to change.`}
            />
          )
        }
      >
        <Icon />
        {display.label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 gap-0.5 p-1">
        {PRIVACY_OPTIONS.map((info) => {
          const ItemIcon = info.icon
          const active = info.value === value
          return (
            <Button
              key={info.value}
              type="button"
              variant={active ? "accent-outline" : "ghost"}
              size="sm"
              onClick={() => void choose(info.value)}
              aria-pressed={active}
              className={cn(
                "h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                active
                  ? "text-accent"
                  : "text-foreground-muted hover:text-foreground"
              )}
            >
              <ItemIcon className="size-3.5" />
              {info.label}
            </Button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export function EditableMentions({
  clipId,
  value,
}: {
  clipId: string
  value: ClipMentionRef[]
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<UserSearchResult[]>(() =>
    value.map(toSearchResult)
  )
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending

  React.useEffect(() => {
    if (open) setDraft(value.map(toSearchResult))
  }, [open, value])

  const commit = () => {
    const nextIds = draft.map((u) => u.id)
    const prevIds = value.map((u) => u.id)
    if (isSameIdSet(nextIds, prevIds)) {
      setOpen(false)
      return
    }
    mutation.mutate(
      { clipId, input: { mentionedUserIds: nextIds } },
      {
        onError: (err) =>
          toast.error("Couldn't update tagged users", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      }
    )
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) commit()
        else setOpen(true)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            aria-label="Edit tagged users"
            className={cn(saving && "opacity-60")}
          />
        }
      >
        <TagIcon className="size-3.5" />
        {value.length === 0 ? "Tag users" : "Edit tags"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-2">
        <MentionPicker value={draft} onChange={setDraft} disabled={saving} />
      </PopoverContent>
    </Popover>
  )
}

function toSearchResult(ref: ClipMentionRef): UserSearchResult {
  return {
    id: ref.id,
    username: ref.username,
    displayUsername: ref.displayUsername,
    name: ref.name,
    image: ref.image,
  }
}

function isSameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  for (const id of b) if (!setA.has(id)) return false
  return true
}
