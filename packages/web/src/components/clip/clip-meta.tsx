import type {
  ClipGameRef,
  ClipMentionRef,
  ClipPrivacy,
  ClipStatus,
} from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import { DropdownMenuItem } from "@alloy/ui/components/dropdown-menu"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { MoreVerticalIcon, RefreshCwIcon, Share2Icon } from "lucide-react"
import type { ReactNode } from "react"

import { GameIcon } from "@/components/game/game-icon"
import { PRIVACY_BY_VALUE } from "@/lib/clip-fields"
import { useReEncodeClipMutation } from "@/lib/clip-queries"

import { ClipActionsMenu } from "./clip-actions-menu"
import { ClipMentionsRow } from "./clip-mentions-row"
import { ClipReannounceMenuItem } from "./clip-reannounce-menu-item"
import { ClipTagsRow } from "./clip-tags-row"
import { renderHashtagTokens } from "./description-tokens"
import { useClipAccess } from "./use-clip-access"
import { useClipShare } from "./use-clip-share"

interface ClipMetaProps {
  /** Clip id — powers each field's PATCH and the delete action. */
  clipId: string
  /** Publication status and background encode state gate media actions. */
  status: ClipStatus
  encodeActive: boolean
  authorId: string
  title: string
  game: string
  gameRef: ClipGameRef | null
  description: string | null
  /** Real privacy value. Pill + popover menu are owner-gated inside. */
  privacy: ClipPrivacy
  views: string
  viewCount: number
  postedAt: string
  uploader: {
    /** Username handle — drives `/u/:handle` profile links. */
    handle: string
    name: string
    avatar: {
      /** Uploader's real avatar URL — falls through to the tinted placeholder. */
      src?: string
      bg?: string
      fg?: string
    }
  }
  mentions: ClipMentionRef[]
  /** Structured hashtags, rendered as a chip row below the description. */
  tags: string[]
  onRequestDelete: () => void
  deletePending: boolean
  onEdit: () => void
  /** Download action for any viewer who can access the clip. */
  downloadAction?: ReactNode
  /** Viewer dialog close button, rendered as the trailing header action. */
  closeAction?: ReactNode
}

function ClipMeta({
  clipId,
  status,
  encodeActive,
  authorId,
  title,
  game,
  gameRef,
  description,
  privacy,
  views,
  viewCount,
  postedAt,
  uploader,
  mentions,
  tags,
  onRequestDelete,
  deletePending,
  onEdit,
  downloadAction,
  closeAction,
}: ClipMetaProps) {
  const { isAdmin, canManage } = useClipAccess(authorId)
  const hasDescription = Boolean(description && description.trim().length > 0)

  const reEncodeMutation = useReEncodeClipMutation()
  const share = useClipShare({
    clipId,
    gameSlug: gameRef?.slug ?? null,
    title,
    privacy,
  })

  const avatarStyle = {
    background: uploader.avatar.bg ?? "var(--neutral-200)",
    color: uploader.avatar.fg ?? "var(--foreground)",
  } as const

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        <ClipTitleWithVisibility
          title={title}
          privacy={privacy}
          heading="h1"
          titleClassName="text-foreground min-w-0 text-lg leading-6 font-semibold wrap-anywhere"
        />
        <div className="text-foreground-dim col-start-1 row-start-2 flex flex-wrap items-center gap-x-1.5 text-xs leading-4">
          <span>
            {views} {tp(viewCount, "view", "views")}
          </span>
          <span aria-hidden="true">·</span>
          <span>{postedAt}</span>
        </div>

        <div className="col-start-2 row-start-1 -my-1.5 flex shrink-0 items-center gap-1 self-start sm:-my-1">
          <FeedbackButton
            variant="ghost"
            size="icon"
            onClick={share.share}
            state={share.feedback.state}
            pendingLabel={<span className="sr-only">{t("Sharing…")}</span>}
            successLabel={<span className="sr-only">{t("Link copied")}</span>}
            errorLabel={<span className="sr-only">{t("Try again")}</span>}
            disabled={privacy === "private"}
            aria-label={
              privacy === "private"
                ? t("Clip link is disabled")
                : t("Share clip")
            }
            title={
              privacy === "private" ? t("Clip link is disabled") : undefined
            }
          >
            <Share2Icon className="size-4" />
          </FeedbackButton>
          <ClipActionsMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Clip actions")}
              >
                <MoreVerticalIcon className="size-4" />
              </Button>
            }
            canManage={canManage}
            deleting={deletePending}
            downloadAction={downloadAction}
            adminActions={
              isAdmin ? (
                <>
                  {status === "failed" || status === "ready" ? (
                    <DropdownMenuItem
                      onClick={() => reEncodeMutation.mutate({ clipId })}
                      disabled={encodeActive || reEncodeMutation.isPending}
                    >
                      <RefreshCwIcon
                        className={cn(encodeActive && "animate-spin")}
                      />
                      {encodeActive ? t("Re-encoding") : t("Re-encode")}
                    </DropdownMenuItem>
                  ) : null}
                  {status === "ready" && privacy === "public" ? (
                    <ClipReannounceMenuItem
                      clipId={clipId}
                      disabled={encodeActive}
                    />
                  ) : null}
                </>
              ) : null
            }
            onEdit={onEdit}
            onDelete={onRequestDelete}
          />
          {closeAction}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/u/$username"
          params={{ username: uploader.handle }}
          aria-label={t("Open {name}'s profile", { name: uploader.name })}
          className="text-foreground hover:text-accent focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-sm text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          <Avatar size="md" style={avatarStyle}>
            {uploader.avatar.src ? (
              <AvatarImage src={uploader.avatar.src} alt="" />
            ) : null}
            <AvatarFallback style={avatarStyle} />
          </Avatar>
          <span className="truncate">{uploader.name}</span>
        </Link>
        <span aria-hidden="true" className="text-foreground-faint shrink-0">
          ·
        </span>
        <ClipGameLink game={game} gameRef={gameRef} />
      </div>

      {mentions.length > 0 ? <ClipMentionsRow mentions={mentions} /> : null}

      {hasDescription ? (
        <p className="text-foreground-muted max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">
          {renderHashtagTokens(description ?? "")}
        </p>
      ) : null}

      <ClipTagsRow tags={tags} className="pt-0.5" />
    </section>
  )
}

function ClipGameLink({
  game,
  gameRef,
}: {
  game: string
  gameRef: ClipGameRef | null
}) {
  const body = (
    <>
      <GameIcon
        src={gameRef?.iconUrl ?? gameRef?.logoUrl ?? null}
        name={game}
        size="sm"
      />
      <span className="truncate">{game}</span>
    </>
  )
  const className =
    "inline-flex min-w-0 max-w-[50%] items-center gap-1.5 text-sm leading-4 text-foreground-muted"
  return gameRef ? (
    <Link
      to="/games/$gameId"
      params={{ gameId: gameRef.slug }}
      className={cn(
        className,
        "rounded-sm hover:text-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
      title={game}
    >
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  )
}

function ClipVisibilityBadge({
  privacy,
  className,
}: {
  privacy: ClipPrivacy
  className?: string
}) {
  const display = PRIVACY_BY_VALUE[privacy]
  const Icon = display.icon

  return (
    <span
      className={cn(
        "text-foreground-muted inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm bg-white/[0.06] px-1.5 text-xs leading-none font-semibold",
        className,
      )}
      title={display.label}
      aria-label={display.label}
    >
      <Icon className="size-3" aria-hidden />
      {display.label}
    </span>
  )
}

function ClipTitleWithVisibility({
  title,
  privacy,
  heading: Heading = "h2",
  className,
  titleClassName,
  badgeClassName,
}: {
  title: string
  privacy: ClipPrivacy
  heading?: "h1" | "h2"
  className?: string
  titleClassName: string
  badgeClassName?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      <Heading className={titleClassName}>{title}</Heading>
      {privacy !== "public" ? (
        <ClipVisibilityBadge privacy={privacy} className={badgeClassName} />
      ) : null}
    </div>
  )
}

export { ClipMeta, ClipTitleWithVisibility, ClipVisibilityBadge }
