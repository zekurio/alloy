import { type ClipPrivacy, type ClipRow, type GameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Link } from "@tanstack/react-router"
import {
  ChevronUpIcon,
  CircleAlertIcon,
  EyeOffIcon,
  GlobeIcon,
  Link2Icon,
  Link2OffIcon,
  SaveIcon,
} from "lucide-react"
import { useRef } from "react"
import type { ComponentType } from "react"

import { useClipMetadataDraft } from "@/components/clip-editor/use-clip-metadata-draft"
import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import { absoluteClipHref } from "@/lib/app-paths"
import { useUpdateClipMutation } from "@/lib/clip-queries"
import { copyTextToClipboard } from "@/lib/clipboard"
import { type RecordingLibraryItem } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { useActionFeedback } from "@/lib/use-action-feedback"

import {
  profileVisibilityIntent,
  type VisibilityIntent,
  visibilityFeedbackIntent,
} from "./library-clip-visibility"
import { ClipFileLocation } from "./library-file-location"

type VisibilityAction = {
  label: string
  pendingLabel: string
  privacy: ClipPrivacy
  copyLink: boolean
  icon: ComponentType<{ className?: string }>
  success: string
  copyFailure?: string
}

const VISIBILITY_ACTIONS = {
  post: {
    label: t("Post"),
    pendingLabel: t("Posting..."),
    privacy: "public",
    copyLink: true,
    icon: GlobeIcon,
    success: t("Clip posted"),
    copyFailure: t("Posted, but couldn't copy the link"),
  },
  unpost: {
    label: t("Unpost"),
    pendingLabel: t("Unposting..."),
    privacy: "unlisted",
    copyLink: false,
    icon: EyeOffIcon,
    success: t("Clip unposted"),
  },
  "create-link": {
    label: t("Create Link"),
    pendingLabel: t("Creating link..."),
    privacy: "unlisted",
    copyLink: true,
    icon: Link2Icon,
    success: t("Link created"),
    copyFailure: t("Link created, but couldn't copy it"),
  },
  "disable-link": {
    label: t("Disable Link"),
    pendingLabel: t("Disabling link..."),
    privacy: "private",
    copyLink: false,
    icon: Link2OffIcon,
    success: t("Clip link disabled"),
  },
} as const satisfies Record<VisibilityIntent, VisibilityAction>

/** Shared by the tabs container and the details form it hosts. */
interface ClipDetailsProps {
  row: ClipRow
  localItem: RecordingLibraryItem | null
  canManage: boolean
  onRequestDelete: () => void
  deleting: boolean
  /** True while the stage holds an unsaved image or trim edit. */
  canSaveMedia: boolean
  /** True while the media edit is being saved. */
  mediaPending: boolean
  mediaError: string | null
  /** Save the media edit with the metadata fields. */
  onSaveMedia: () => void
}

function gameRowFromRef(row: ClipRow): GameRow | null {
  const ref = row.gameRef
  if (!ref) return null
  return {
    id: ref.id,
    steamgriddbId: ref.steamgriddbId,
    source: ref.source,
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

/** Metadata sheet: the dialog editor's fields and dirty tracking, inline. */
export function ClipEditorDetails({
  row,
  localItem,
  canManage,
  onRequestDelete,
  deleting,
  canSaveMedia,
  mediaPending,
  mediaError,
  onSaveMedia,
}: ClipDetailsProps) {
  const {
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
    titleChanged,
    descriptionChanged,
    gameChanged,
    mentionsChanged,
    tagsChanged,
    dirty,
  } = useClipMetadataDraft(
    {
      title: row.title,
      description: row.description ?? "",
      game: gameRowFromRef(row),
      mentions: row.mentions ?? [],
      tags: row.tags,
    },
    {
      title: row.title,
      description: row.description ?? "",
      gameId: row.gameRef?.id ?? null,
      mentionIds: (row.mentions ?? []).map((mention) => mention.id),
      tags: row.tags,
    },
  )
  const saveMutation = useUpdateClipMutation()
  const visibilityMutation = useUpdateClipMutation()
  const saveFeedback = useActionFeedback()
  const visibilityFeedback = useActionFeedback()
  const activeVisibilityIntent = useRef<VisibilityIntent | null>(null)
  const saving = saveMutation.isPending
  const visibilityPending = visibilityMutation.isPending

  const copyClipLink = async (clip: ClipRow = row) => {
    return copyTextToClipboard(
      absoluteClipHref(clip.gameRef?.slug ?? null, clip.id, publicOrigin()),
      {
        action: "copy clip link",
      },
    )
  }

  // Visibility changes save immediately from the action controls — they're
  // publish/link actions, not draft fields like the rest of the form.
  const updateVisibility = (intent: VisibilityIntent) => {
    const action = VISIBILITY_ACTIONS[intent]
    if (visibilityPending || action.privacy === row.privacy) return
    activeVisibilityIntent.current = intent
    void visibilityFeedback.run(async () => {
      const updated = await visibilityMutation.mutateAsync({
        clipId: row.id,
        input: { privacy: action.privacy },
      })
      if (action.copyLink && !(await copyClipLink(updated))) {
        throw new Error(
          action.copyFailure ??
            t("Visibility updated, but couldn't copy the link"),
        )
      }
    }, t("Couldn't update visibility"))
  }

  // Save commits everything outstanding at once: the field edits and any
  // pending media edit from the stage. The two server calls are independent.
  const handleSave = () => {
    if (saving || mediaPending || titleInvalid) return
    if (canSaveMedia) onSaveMedia()
    if (!dirty) return
    const input: Parameters<typeof saveMutation.mutate>[0]["input"] = {}
    if (titleChanged) input.title = normalizedTitle
    if (descriptionChanged) input.description = normalizedDescription
    if (gameChanged) input.gameId = game?.id ?? null
    if (mentionsChanged) input.mentionedUserIds = mentionIds
    if (tagsChanged) input.tags = tags
    void saveFeedback.run(async () => {
      await saveMutation.mutateAsync({ clipId: row.id, input })
    }, t("Couldn't save changes"))
  }

  const profileIntent = profileVisibilityIntent(row.privacy)
  const linkIntent = row.privacy === "private" ? "create-link" : "disable-link"
  const profileVisibilityAction = VISIBILITY_ACTIONS[profileIntent]
  const linkVisibilityAction = VISIBILITY_ACTIONS[linkIntent]
  const feedbackVisibilityAction =
    VISIBILITY_ACTIONS[
      visibilityFeedbackIntent(
        row.privacy,
        activeVisibilityIntent.current,
        visibilityFeedback.feedback.state !== "idle",
      )
    ]
  const ProfileVisibilityIcon = profileVisibilityAction.icon
  const LinkVisibilityIcon = linkVisibilityAction.icon

  const primaryPublishes = !dirty && !canSaveMedia
  const primaryDisabled = primaryPublishes
    ? visibilityPending || deleting
    : (!dirty && !canSaveMedia) || titleInvalid || saving || mediaPending
  const primaryLabel = primaryPublishes
    ? visibilityPending
      ? feedbackVisibilityAction.pendingLabel
      : profileVisibilityAction.label
    : saving || mediaPending
      ? t("Saving…")
      : t("Save")
  const PrimaryIcon = primaryPublishes ? ProfileVisibilityIcon : SaveIcon
  const showProfileVisibilityInMenu = !primaryPublishes
  const primaryFeedback = primaryPublishes
    ? visibilityFeedback.feedback
    : saveFeedback.feedback
  const actionError =
    saveFeedback.feedback.state === "error"
      ? saveFeedback.feedback.message
      : visibilityFeedback.feedback.state === "error"
        ? visibilityFeedback.feedback.message
        : mediaError

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
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

      {actionError ? (
        <Callout tone="destructive" className="text-xs">
          <CircleAlertIcon />
          <span>{actionError}</span>
        </Callout>
      ) : null}

      <ClipFileLocation
        row={row}
        localItem={localItem}
        deleteAction={
          canManage
            ? {
                disabled: deleting || saving || visibilityPending,
                label: t("Delete clip"),
                pending: deleting,
                pendingLabel: t("Deleting..."),
                onSelect: onRequestDelete,
              }
            : null
        }
      />

      {canManage ? (
        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={deleting || saving || visibilityPending}
            className={visibilityPending ? "disabled:opacity-100" : undefined}
            render={<Link to="/library" />}
          >
            {t("Cancel")}
          </Button>
          <div className="flex items-center">
            <FeedbackButton
              type="button"
              variant="primary"
              disabled={primaryDisabled}
              state={primaryFeedback.state}
              pendingLabel={primaryLabel}
              successLabel={
                primaryPublishes ? feedbackVisibilityAction.success : t("Saved")
              }
              errorLabel={t("Try again")}
              className="rounded-r-none"
              onClick={() => {
                if (primaryPublishes) updateVisibility(profileIntent)
                else handleSave()
              }}
            >
              <PrimaryIcon />
              {primaryLabel}
            </FeedbackButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="primary"
                    size="icon"
                    disabled={saving || deleting || visibilityPending}
                    aria-label={t("More clip options")}
                    className="border-l-accent-hover size-9 rounded-l-none sm:size-8"
                  />
                }
              >
                <ChevronUpIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                {showProfileVisibilityInMenu ? (
                  <DropdownMenuItem
                    disabled={visibilityPending}
                    onClick={() => {
                      updateVisibility(profileIntent)
                    }}
                  >
                    <ProfileVisibilityIcon className="size-4" />
                    {profileVisibilityAction.label}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={visibilityPending}
                  onClick={() => {
                    updateVisibility(linkIntent)
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
    </div>
  )
}
