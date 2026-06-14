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
import { useNavigate } from "@tanstack/react-router"
import {
  ClapperboardIcon,
  ChevronUpIcon,
  GlobeIcon,
  Link2Icon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { ClipComments } from "@/components/clip/clip-comments"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { absoluteClipHref } from "@/lib/app-paths"
import { normalizeClipDescription, normalizeClipTitle } from "@/lib/clip-fields"
import { useUpdateClipMutation } from "@/lib/clip-queries"
import { copyTextToClipboard } from "@/lib/clipboard"
import { alloyDesktop, type RecordingLibraryItem } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"

import { ClipFileLocation } from "./library-file-location"

/** Shared by the tabs container and the details form it hosts. */
interface ClipDetailsProps {
  row: ClipRow
  localItem: RecordingLibraryItem | null
  canManage: boolean
  onRequestDelete: () => void
  deleting: boolean
  /** True while the stage holds a valid, uncommitted trim. */
  canSaveTrim: boolean
  /** True while a saved trim is being applied on the server. */
  trimPending: boolean
  /** Commits the stage's pending trim — Save runs it with the fields. */
  onSaveTrim: () => void
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
  localItem,
  canManage,
  onRequestDelete,
  deleting,
  canSaveTrim,
  trimPending,
  onSaveTrim,
}: ClipDetailsProps) {
  const navigate = useNavigate()
  const desktop = alloyDesktop()
  const [title, setTitle] = React.useState(row.title)
  const [description, setDescription] = React.useState(row.description ?? "")
  const [game, setGame] = React.useState<GameRow | null>(() =>
    gameRowFromRef(row),
  )
  const [mentions, setMentions] = React.useState<UserSearchResult[]>(() =>
    (row.mentions ?? []).map(mentionToSearchResult),
  )
  const [tags, setTags] = React.useState<string[]>(row.tags)
  const saveMutation = useUpdateClipMutation()
  const visibilityMutation = useUpdateClipMutation()
  const saving = saveMutation.isPending
  const visibilityPending = visibilityMutation.isPending

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

  const copyClipLink = async (clip: ClipRow = row) => {
    const slug = clip.gameRef?.slug
    if (!slug) return false
    return copyTextToClipboard(
      absoluteClipHref(slug, clip.id, publicOrigin()),
      {
        action: "copy clip link",
      },
    )
  }

  // Visibility changes save immediately from the publish controls — they're
  // publish actions, not draft fields like the rest of the form.
  const publishClip = (privacy: ClipPrivacy) => {
    if (visibilityPending || privacy === row.privacy) return
    visibilityMutation.mutate(
      { clipId: row.id, input: { privacy } },
      {
        onSuccess: async (updated) => {
          const copied = await copyClipLink(updated)
          if (privacy === "public") {
            toast[copied ? "success" : "error"](
              copied
                ? "Posted and link copied"
                : "Posted, but couldn't copy the link",
            )
          } else {
            toast[copied ? "success" : "error"](
              copied
                ? "Link created and copied"
                : "Link created, but couldn't copy it",
            )
          }
        },
        onError: () => toast.error("Couldn't update visibility"),
      },
    )
  }

  // Save commits everything outstanding at once: the field edits and any
  // pending trim from the stage. The two server calls are independent.
  const handleSave = () => {
    if (saving || trimPending || titleInvalid) return
    if (canSaveTrim) onSaveTrim()
    if (!dirty) return
    const input: Parameters<typeof saveMutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (gameChanged && game) input.steamgriddbId = game.steamgriddbId
    if (mentionsChanged) input.mentionedUserIds = mentionIds
    if (tagsChanged) input.tags = tags
    saveMutation.mutate(
      { clipId: row.id, input },
      {
        onSuccess: () => toast.success("Clip updated"),
        onError: () => toast.error("Couldn't save changes"),
      },
    )
  }
  const primaryPublishes = !dirty && !canSaveTrim
  const primaryDisabled = primaryPublishes
    ? row.privacy === "public" || visibilityPending || deleting
    : (!dirty && !canSaveTrim) || titleInvalid || saving || trimPending
  const primaryLabel = primaryPublishes
    ? visibilityPending
      ? "Posting…"
      : "Post"
    : saving || trimPending
      ? "Saving…"
      : "Save"

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

      <ClipFileLocation row={row} localItem={localItem} />

      {canManage ? (
        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={deleting || saving || visibilityPending}
            onClick={onRequestDelete}
          >
            <Trash2Icon />
            Delete
          </Button>
          <div className="flex items-center">
            <Button
              type="button"
              variant="primary"
              disabled={primaryDisabled}
              className="rounded-r-none"
              onClick={() => {
                if (primaryPublishes) publishClip("public")
                else handleSave()
              }}
            >
              {primaryPublishes ? <GlobeIcon /> : <SaveIcon />}
              {primaryLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="primary"
                    size="icon"
                    disabled={saving || deleting || visibilityPending}
                    aria-label="More clip options"
                    className="border-l-accent-hover rounded-l-none"
                  />
                }
              >
                <ChevronUpIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                {desktop ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void navigate({
                        to: "/editor",
                        search: { capture: row.id },
                      })
                    }}
                  >
                    <ClapperboardIcon className="size-4" />
                    Open in Editor
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={row.privacy === "public"}
                  onClick={() => {
                    publishClip("public")
                  }}
                >
                  <GlobeIcon className="size-4" />
                  Post
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    publishClip("unlisted")
                  }}
                >
                  <Link2Icon className="size-4" />
                  Create Link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </>
  )
}
