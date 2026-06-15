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
  EyeOffIcon,
  GlobeIcon,
  Link2Icon,
  Link2OffIcon,
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

type VisibilityIntent = "post" | "unpost" | "create-link" | "disable-link"

type VisibilityAction = {
  label: string
  pendingLabel: string
  privacy: ClipPrivacy
  copyLink: boolean
  icon: React.ComponentType<{ className?: string }>
  success: string
  copySuccess?: string
  copyFailure?: string
}

const VISIBILITY_ACTIONS = {
  post: {
    label: "Post",
    pendingLabel: "Posting...",
    privacy: "public",
    copyLink: true,
    icon: GlobeIcon,
    success: "Clip posted",
    copySuccess: "Posted and link copied",
    copyFailure: "Posted, but couldn't copy the link",
  },
  unpost: {
    label: "Unpost",
    pendingLabel: "Unposting...",
    privacy: "unlisted",
    copyLink: false,
    icon: EyeOffIcon,
    success: "Clip unposted",
  },
  "create-link": {
    label: "Create Link",
    pendingLabel: "Creating link...",
    privacy: "unlisted",
    copyLink: true,
    icon: Link2Icon,
    success: "Link created",
    copySuccess: "Link created and copied",
    copyFailure: "Link created, but couldn't copy it",
  },
  "disable-link": {
    label: "Disable Link",
    pendingLabel: "Disabling link...",
    privacy: "private",
    copyLink: false,
    icon: Link2OffIcon,
    success: "Clip link disabled",
  },
} as const satisfies Record<VisibilityIntent, VisibilityAction>

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
    igdbId: ref.igdbId,
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

  // Visibility changes save immediately from the action controls — they're
  // publish/link actions, not draft fields like the rest of the form.
  const updateVisibility = (action: VisibilityAction) => {
    if (visibilityPending || action.privacy === row.privacy) return
    visibilityMutation.mutate(
      { clipId: row.id, input: { privacy: action.privacy } },
      {
        onSuccess: async (updated) => {
          if (action.copyLink) {
            const copied = await copyClipLink(updated)
            toast[copied ? "success" : "error"](
              copied
                ? (action.copySuccess ?? action.success)
                : (action.copyFailure ??
                    "Visibility updated, but couldn't copy the link"),
            )
            return
          }
          toast.success(action.success)
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
    if (gameChanged) input.igdbId = game?.igdbId ?? null
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

  const profileVisibilityAction =
    VISIBILITY_ACTIONS[row.privacy === "public" ? "unpost" : "post"]
  const linkVisibilityAction =
    VISIBILITY_ACTIONS[
      row.privacy === "private" ? "create-link" : "disable-link"
    ]
  const ProfileVisibilityIcon = profileVisibilityAction.icon
  const LinkVisibilityIcon = linkVisibilityAction.icon

  const primaryPublishes = !dirty && !canSaveTrim
  const primaryDisabled = primaryPublishes
    ? visibilityPending || deleting
    : (!dirty && !canSaveTrim) || titleInvalid || saving || trimPending
  const primaryLabel = primaryPublishes
    ? visibilityPending
      ? profileVisibilityAction.pendingLabel
      : profileVisibilityAction.label
    : saving || trimPending
      ? "Saving…"
      : "Save"
  const PrimaryIcon = primaryPublishes ? ProfileVisibilityIcon : SaveIcon
  const showProfileVisibilityInMenu = !primaryPublishes

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
              className="h-10 rounded-r-none sm:h-8"
              onClick={() => {
                if (primaryPublishes) updateVisibility(profileVisibilityAction)
                else handleSave()
              }}
            >
              <PrimaryIcon />
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
                    className="border-l-accent-hover size-10 rounded-l-none sm:size-8"
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
                {showProfileVisibilityInMenu ? (
                  <DropdownMenuItem
                    disabled={visibilityPending}
                    onClick={() => {
                      updateVisibility(profileVisibilityAction)
                    }}
                  >
                    <ProfileVisibilityIcon className="size-4" />
                    {profileVisibilityAction.label}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={visibilityPending}
                  onClick={() => {
                    updateVisibility(linkVisibilityAction)
                  }}
                >
                  <LinkVisibilityIcon className="size-4" />
                  {linkVisibilityAction.label}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </>
  )
}
