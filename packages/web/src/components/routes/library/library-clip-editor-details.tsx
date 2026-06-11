import {
  type ClipMentionRef,
  type ClipPrivacy,
  type ClipRow,
  type GameRow,
  type UserSearchResult,
} from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@alloy/ui/components/tabs"
import { toast } from "@alloy/ui/lib/toast"
import { SaveIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ClipComments } from "@/components/clip/clip-comments"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { normalizeClipDescription, normalizeClipTitle } from "@/lib/clip-fields"
import { useUpdateClipMutation } from "@/lib/clip-queries"

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
  const [privacy, setPrivacy] = React.useState<ClipPrivacy>(row.privacy)
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
  const privacyChanged = privacy !== row.privacy
  const gameChanged = (game?.id ?? null) !== (row.gameRef?.id ?? null)
  const mentionsChanged = !sameIdSet(mentionIds, originalMentionIds)
  const tagsChanged = !sameIdSet(tags, row.tags)

  const dirty =
    titleChanged ||
    descriptionChanged ||
    privacyChanged ||
    gameChanged ||
    mentionsChanged ||
    tagsChanged
  const titleInvalid = trimmedTitle.length === 0

  const handleSave = () => {
    if (!dirty || titleInvalid || saving) return
    const input: Parameters<typeof mutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = trimmedTitle
    if (descriptionChanged) input.description = trimmedDescription
    if (privacyChanged) input.privacy = privacy
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
        privacy={privacy}
        onPrivacyChange={setPrivacy}
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
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || titleInvalid || saving}
            onClick={handleSave}
          >
            <SaveIcon />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </>
  )
}
