import type { ClipGameRef, ClipMentionRef, ClipPrivacy } from "@alloy/api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  HeartIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  StarIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react"
import * as React from "react"

import { useSession } from "@/lib/auth-client"
import { shareUrlWithFallback } from "@/lib/browser-share"
import { currentUrlWithoutSearchOrHash } from "@/lib/browser-url"
import { PRIVACY_BY_VALUE } from "@/lib/clip-fields"
import {
  useDeleteClipMutation,
  useLikeStateQuery,
  useToggleLikeMutation,
} from "@/lib/clip-queries"
import { errorMessage } from "@/lib/error-message"
import { useGameQuery, useToggleGameFavoriteMutation } from "@/lib/game-queries"
import { formatCount } from "@/lib/number-format"
import {
  useToggleUserFollowMutation,
  useUserProfileQuery,
  useUserProfileViewerQuery,
} from "@/lib/user-queries"

import { ClipMentionsRow } from "./clip-mentions-row"
import { ClipTagsRow } from "./clip-tags-row"
import { renderHashtagTokens } from "./description-tokens"

interface ClipMetaProps {
  /** Clip id — powers each field's PATCH and the delete action. */
  clipId: string
  authorId: string
  title: string
  game: string
  gameRef: ClipGameRef | null
  description: string | null
  /** Real privacy value. Pill + popover menu are owner-gated inside. */
  privacy: ClipPrivacy
  views: string
  postedAt: string
  uploader: {
    /** Username handle — drives `/u/:handle` profile links. */
    handle: string
    name: string
    avatar: {
      initials: string
      /** Uploader's real avatar URL — falls through to initials on miss. */
      src?: string
      bg?: string
      fg?: string
    }
  }
  likes: number
  mentions: ClipMentionRef[]
  /** Structured hashtags, rendered as a chip row below the description. */
  tags: string[]
  /** Fired after a successful delete — e.g. closes the player modal. */
  onDeleted?: () => void
  onEdit?: () => void
}

function ClipMeta({
  clipId,
  authorId,
  title,
  game,
  gameRef,
  description,
  privacy,
  views,
  postedAt,
  uploader,
  likes,
  mentions,
  tags,
  onDeleted,
  onEdit,
}: ClipMetaProps) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const isOwner = viewerId !== null && viewerId === authorId
  const isAdmin = viewerRole === "admin"
  const canManage = isOwner || isAdmin
  const canLike = viewerId !== null
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const hasDescription = Boolean(description && description.trim().length > 0)

  const deleteMutation = useDeleteClipMutation()
  const deleting = deleteMutation.isPending

  const likeStateQuery = useLikeStateQuery(clipId, { enabled: canLike })
  const likeMutation = useToggleLikeMutation()
  const pendingLiked =
    likeMutation.isPending && likeMutation.variables?.clipId === clipId
      ? likeMutation.variables.nextLiked
      : undefined
  const liked = pendingLiked ?? likeStateQuery.data?.liked ?? false

  const profileQuery = useUserProfileQuery(uploader.handle)
  const profileViewerQuery = useUserProfileViewerQuery(uploader.handle)
  const profileData = profileQuery.data
  const followerCount = profileData?.counts.followers ?? null
  const profileViewer = profileViewerQuery.data?.viewer
  const followMutation = useToggleUserFollowMutation(uploader.handle)
  const followPending = followMutation.isPending
  const isFollowing = profileViewer?.isFollowing ?? false
  const canFollow =
    viewerId !== null &&
    profileViewer !== undefined &&
    profileViewer !== null &&
    !profileViewer.isSelf &&
    !profileViewer.isBlockedBy

  const handleLikeToggle = React.useCallback(() => {
    if (!canLike) return
    likeMutation.mutate(
      { clipId, nextLiked: !liked },
      {
        onError: () => toast.error("Couldn't update like"),
      },
    )
  }, [canLike, clipId, liked, likeMutation])

  const handleDelete = React.useCallback(() => {
    deleteMutation.mutate(
      { clipId },
      {
        onSuccess: () => {
          toast.success("Clip deleted")
          onDeleted?.()
        },
        onError: () => toast.error("Couldn't delete clip"),
      },
    )
  }, [clipId, deleteMutation, onDeleted])

  const handleShare = React.useCallback(async () => {
    const url = currentUrlWithoutSearchOrHash()
    if (url === null) {
      toast.error("Couldn't share clip")
      return
    }

    const result = await shareUrlWithFallback(url, {
      title,
      action: "share clip link",
    })
    if (result === "copied") {
      toast.success("Link copied")
    } else if (result === "failed") {
      toast.error("Couldn't share clip")
    }
  }, [title])

  function handleFollow() {
    if (followPending || !profileViewer) return
    followMutation.mutate(
      { next: !isFollowing },
      {
        onError: (cause) => {
          toast.error(errorMessage(cause, "Something went wrong"))
        },
      },
    )
  }

  const avatarStyle = {
    background: uploader.avatar.bg ?? "var(--neutral-200)",
    color: uploader.avatar.fg ?? "var(--foreground)",
  } as const

  return (
    <section className="flex flex-col gap-2">
      {/* Title + top-right actions */}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-foreground min-w-0 text-2xl leading-none font-bold tracking-[-0.02em] sm:text-[2rem]">
          {title}
        </h1>

        <div className="flex shrink-0 items-center gap-1 self-start">
          <Button
            variant={liked ? "accent-outline" : "ghost"}
            size="sm"
            onClick={handleLikeToggle}
            disabled={!canLike || likeMutation.isPending}
            aria-pressed={liked}
            aria-label={canLike ? "Like clip" : "Sign in to like"}
            title={canLike ? undefined : "Sign in to like"}
          >
            <HeartIcon className={cn(liked && "fill-current")} />
            <span className="tabular-nums">{formatCount(likes)}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleShare}
            aria-label="Share clip"
          >
            <Share2Icon />
          </Button>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clip actions"
                  >
                    <MoreHorizontalIcon className="rotate-90" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-[150px]">
                <DropdownMenuItem onClick={onEdit}>
                  <PencilIcon /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2Icon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {/* User row */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/u/$username"
            params={{ username: uploader.handle }}
            aria-label={`Open ${uploader.name}'s profile`}
            className={cn(
              "shrink-0 rounded-md",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            )}
          >
            <Avatar size="lg" style={avatarStyle}>
              {uploader.avatar.src ? (
                <AvatarImage src={uploader.avatar.src} alt={uploader.name} />
              ) : null}
              <AvatarFallback style={avatarStyle}>
                {uploader.avatar.initials}
              </AvatarFallback>
            </Avatar>
          </Link>

          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <Link
                to="/u/$username"
                params={{ username: uploader.handle }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-lg font-semibold tracking-[-0.01em] text-foreground",
                  "hover:text-accent",
                  "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                  "focus-visible:text-accent focus-visible:outline-none",
                )}
              >
                <span className="truncate">@{uploader.name}</span>
              </Link>
              {canFollow ? (
                <Button
                  type="button"
                  variant={isFollowing ? "ghost" : "primary"}
                  size="sm"
                  onClick={() => void handleFollow()}
                  disabled={followPending}
                >
                  {isFollowing ? <UserMinusIcon /> : <UserPlusIcon />}
                  {followPending ? "…" : isFollowing ? "Following" : "Follow"}
                </Button>
              ) : null}
            </div>
            {followerCount !== null ? (
              <div className="text-foreground-faint mt-0.5 text-xs">
                <span className="text-foreground-muted">
                  {formatCount(followerCount)}
                </span>{" "}
                followers
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <ClipGameBadge game={game} gameRef={gameRef} />
          <div className="text-foreground-faint flex items-center gap-1.5 pt-0.5 text-xs leading-4">
            {privacy !== "public" ? (
              <>
                <ClipPrivacyBadge privacy={privacy} />
                <span>•</span>
              </>
            ) : null}
            <span>{views} views</span>
            <span>•</span>
            <span>{postedAt}</span>
          </div>
        </div>
      </div>

      {mentions.length > 0 ? <ClipMentionsRow mentions={mentions} /> : null}

      {hasDescription ? (
        <p className="text-foreground-muted max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">
          {renderHashtagTokens(description ?? "", { linkHashtags: true })}
        </p>
      ) : null}

      <ClipTagsRow tags={tags} className="pt-0.5" />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete clip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ClipGameBadge({
  game,
  gameRef,
}: {
  game: string
  gameRef: ClipGameRef | null
}) {
  const navigate = useNavigate()
  const icon = gameRef?.iconUrl ?? gameRef?.logoUrl ?? null
  const slug = gameRef?.slug ?? ""
  const gameQuery = useGameQuery(slug)
  const favoriteMutation = useToggleGameFavoriteMutation()
  const viewer = gameQuery.data?.viewer
  const isFavorite = viewer?.isFollowing ?? false
  const canToggle = Boolean(gameRef) && viewer !== undefined

  function toggleFavorite() {
    if (!gameRef || !canToggle || favoriteMutation.isPending) return
    if (!viewer) {
      void navigate({ to: "/login" })
      return
    }
    favoriteMutation.mutate(
      { slug: gameRef.slug, next: !isFavorite },
      {
        onError: (cause) => {
          toast.error(errorMessage(cause, "Something went wrong"))
        },
      },
    )
  }

  const gameBody = (
    <>
      <GameIcon src={icon} name={game} />
      <span className="truncate">{game}</span>
    </>
  )

  const base = cn(
    "inline-flex h-8 items-center overflow-hidden rounded-lg border border-border bg-surface-raised",
  )

  const starBtn = (
    <button
      type="button"
      disabled={!canToggle || favoriteMutation.isPending}
      title={
        !gameRef
          ? "Game details unavailable"
          : viewer === null
            ? "Sign in to favourite"
            : isFavorite
              ? "Remove from favourites"
              : "Add to favourites"
      }
      aria-label={
        isFavorite ? "Remove game from favourites" : "Add game to favourites"
      }
      onClick={toggleFavorite}
      className={cn(
        "inline-flex h-full items-center justify-center px-2.5 transition-colors",
        "text-foreground-faint hover:bg-white/5 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        isFavorite && "text-accent",
      )}
    >
      <StarIcon className={cn("size-4", isFavorite && "fill-current")} />
    </button>
  )

  const separator = <div className="bg-border h-4 w-px" />

  if (gameRef) {
    return (
      <div className={base}>
        {starBtn}
        {separator}
        <Link
          to="/g/$slug"
          params={{ slug: gameRef.slug }}
          className="text-foreground-muted hover:text-foreground inline-flex h-full items-center gap-2 px-2.5 text-sm font-semibold transition-colors"
          title={game}
        >
          {gameBody}
        </Link>
      </div>
    )
  }

  return (
    <div className={base}>
      {starBtn}
      {separator}
      <span className="text-foreground-muted inline-flex h-full items-center gap-2 px-2.5 text-sm leading-4 font-semibold">
        {gameBody}
      </span>
    </div>
  )
}

function ClipPrivacyBadge({ privacy }: { privacy: ClipPrivacy }) {
  const display = PRIVACY_BY_VALUE[privacy]
  const Icon = display.icon

  return (
    <span className="text-foreground-faint inline-flex items-center gap-1 leading-4">
      <Icon className="size-3" />
      <span className="tabular-nums">{display.label}</span>
    </span>
  )
}

export { ClipMeta }
