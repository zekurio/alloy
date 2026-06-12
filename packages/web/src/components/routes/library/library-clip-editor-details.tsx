import {
  type ClipMentionRef,
  type ClipPrivacy,
  type ClipRow,
  type GameRow,
  type UserSearchResult,
} from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@alloy/ui/components/tabs"
import { toast } from "@alloy/ui/lib/toast"
import {
  ChevronUpIcon,
  GlobeIcon,
  Link2Icon,
  SaveIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react"
import * as React from "react"

import { ClipComments } from "@/components/clip/clip-comments"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { absoluteClipHref } from "@/lib/app-paths"
import { normalizeClipDescription, normalizeClipTitle } from "@/lib/clip-fields"
import { useUpdateClipMutation } from "@/lib/clip-queries"
import { copyTextToClipboard } from "@/lib/clipboard"
import { publicOrigin } from "@/lib/env"

/** Shared by the tabs container and the details form it hosts. */
interface ClipDetailsProps {
  row: ClipRow
  canManage: boolean
  onRequestDelete: () => void
  deleting: boolean
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
    heroBlurHash: ref.heroBlurHash,
    gridUrl: ref.gridUrl,
    gridBlurHash: ref.gridBlurHash,
    logoUrl: ref.logoUrl,
    iconUrl: ref.iconUrl,
  }
}

function mentionToSearchResult(ref: ClipMentionRef): UserSearchResult {
  return {
    id: ref.id,
    username: ref.username,
    displayUsername: ref.displayUsername,
    image: ref.image,
  }
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

export function ClipEditorTabs(props: ClipDetailsProps) {
  const { row } = props
  const [tab, setTab] = React.useState("details")

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(String(value))}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList className="shrink-0 px-4 pt-1">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="comments">
          Comments
          {row.commentCount > 0 ? (
            <TabsCount>{row.commentCount}</TabsCount>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="details"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
      >
        <ClipDetailsForm {...props} />
      </TabsContent>

      <TabsContent value="comments" className="min-h-0 flex-1">
        <ClipComments
          clipId={row.id}
          clipAuthorId={row.authorId}
          className="h-full border-l-0"
        />
      </TabsContent>
    </Tabs>
  )
}

/** Metadata sheet: the dialog editor's fields and dirty tracking, inline. */
function ClipDetailsForm({
  row,
  canManage,
  onRequestDelete,
  deleting,
}: ClipDetailsProps) {
  const [title, setTitle] = React.useState(row.title)
  const [description, setDescription] = React.useState(row.description ?? "")
  const [game, setGame] = React.useState<GameRow | null>(() =>
    gameRowFromRef(row),
  )
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(() =>
    (row.mentions ?? []).map(mentionToSearchResult),
  )
  const [tags, setTags] = React.useState<string[]>(row.tags)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending

  const trimmedTitle = normalizeClipTitle(title)
  const trimmedDescription = normalizeClipDescription(description)
  const currentDescription = row.description ?? ""
  const originalMentionIds = (row.mentions ?? []).map((m) => m.id)
  const mentionIds = mentions.map((m) => m.id)

  const titleChanged = trimmedTitle !== row.title && trimmedTitle.length > 0
  const descriptionChanged = trimmedDescription !== currentDescription.trim()
  const gameChanged = (game?.id ?? null) !== (row.gameRef?.id ?? null)
  const mentionsChanged = !sameIdSet(mentionIds, originalMentionIds)
  const tagsChanged = !sameIdSet(tags, row.tags)

  const dirty =
    titleChanged ||
    descriptionChanged ||
    gameChanged ||
    mentionsChanged ||
    tagsChanged
  const titleInvalid = trimmedTitle.length === 0

  // Visibility changes save immediately from the publish dropdown — they're
  // an action ("Post" / "Unpost"), not a draft field like the rest of the form.
  const setClipPrivacy = (privacy: ClipPrivacy) => {
    if (saving || privacy === row.privacy) return
    mutation.mutate(
      { clipId: row.id, input: { privacy } },
      {
        onSuccess: () =>
          toast.success(
            privacy === "public"
              ? "Posted to your profile"
              : "Removed from your profile",
          ),
        onError: () => toast.error("Couldn't update visibility"),
      },
    )
  }

  const copyLink = async () => {
    const slug = row.gameRef?.slug
    if (!slug) {
      toast.error("Couldn't copy the clip link")
      return
    }
    const copied = await copyTextToClipboard(
      absoluteClipHref(slug, row.id, publicOrigin()),
      { action: "copy clip link" },
    )
    if (copied) {
      toast.success("Link copied to clipboard")
    } else {
      toast.error("Couldn't copy the clip link")
    }
  }

  const handleSave = () => {
    if (!dirty || titleInvalid || saving) return
    const input: Parameters<typeof mutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (gameChanged && game) input.steamgriddbId = game.steamgriddbId
    if (mentionsChanged) input.mentionedUserIds = mentionIds
    if (tagsChanged) input.tags = tags
    mutation.mutate(
      { clipId: row.id, input },
      {
        onSuccess: () => toast.success("Clip updated"),
        onError: () => toast.error("Couldn't save changes"),
      },
    )
  }

  return (
    <>
      <ClipMetadataEditor
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        game={game}
        onGameChange={setGame}
        mentions={mentions}
        onMentionsChange={setMentions}
        tags={tags}
        onTagsChange={setTags}
        disabled={saving || !canManage}
        titleInvalid={titleInvalid}
      />

      {canManage ? (
        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={deleting || saving}
            onClick={onRequestDelete}
          >
            <Trash2Icon />
            Delete
          </Button>
          <div className="flex items-center">
            <Button
              type="button"
              variant="primary"
              disabled={!dirty || titleInvalid || saving}
              className="rounded-r-none"
              onClick={handleSave}
            >
              <SaveIcon />
              {saving ? "Saving…" : "Save"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="primary"
                    size="icon"
                    disabled={saving || deleting}
                    aria-label="More clip options"
                    className="border-l-accent-hover rounded-l-none"
                  />
                }
              >
                <ChevronUpIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                {row.privacy === "public" ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setClipPrivacy("unlisted")
                    }}
                  >
                    <UndoIcon className="size-4" />
                    Unpost from Profile
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => {
                      setClipPrivacy("public")
                    }}
                  >
                    <GlobeIcon className="size-4" />
                    Post to Profile
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    void copyLink()
                  }}
                >
                  <Link2Icon className="size-4" />
                  Copy Link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </>
  )
}
