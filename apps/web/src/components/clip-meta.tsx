import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  EyeIcon,
  HeartIcon,
  Share2Icon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { toast } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";

import { useSession } from "../lib/auth-client";
import {
  useDeleteClipMutation,
  useLikeStateQuery,
  useToggleLikeMutation,
} from "../lib/clip-queries";
import type {
  ClipGameRef,
  ClipMentionRef,
  ClipPrivacy,
} from "../lib/clips-api";
import { formatCount } from "../lib/clip-format";
import {
  useUserProfileQuery,
  useProfileCachePatchers,
} from "../lib/user-queries";
import { followUser, unfollowUser } from "../lib/users-api";

import { ClipMentionsRow } from "./clip-mentions-row";
import {
  EditableDescription,
  EditableGame,
  EditableMentions,
  EditableTitle,
  PrivacyBadgeMenu,
} from "./clip-meta-editors";

interface ClipMetaProps {
  /** Clip id — powers each field's PATCH and the delete action. */
  clipId: string;
  authorId: string;
  title: string;
  game: string;
  gameRef: ClipGameRef | null;
  description: string | null;
  /** Real privacy value. Pill + popover menu are owner-gated inside. */
  privacy: ClipPrivacy;
  views: string;
  postedAt: string;
  uploader: {
    /** Username handle — drives `/u/:handle` profile links. */
    handle: string;
    name: string;
    avatar: {
      initials: string;
      /** Uploader's real avatar URL — falls through to initials on miss. */
      src?: string;
      bg?: string;
      fg?: string;
    };
  };
  likes: number;
  comments: number;
  mentions: ClipMentionRef[];
  /** Fired after a successful delete — e.g. closes the player modal. */
  onDeleted?: () => void;
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
  onDeleted,
}: ClipMetaProps) {
  const { data: session } = useSession();
  const viewerId = session?.user?.id ?? null;
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isOwner = viewerId !== null && viewerId === authorId;
  const isAdmin = viewerRole === "admin";
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;
  const canLike = viewerId !== null;

  const deleteMutation = useDeleteClipMutation();
  const deleting = deleteMutation.isPending;

  const likeStateQuery = useLikeStateQuery(clipId, { enabled: canLike });
  const likeMutation = useToggleLikeMutation();
  const pendingLiked =
    likeMutation.isPending && likeMutation.variables?.clipId === clipId
      ? likeMutation.variables.nextLiked
      : undefined;
  const liked = pendingLiked ?? likeStateQuery.data?.liked ?? false;

  const profileQuery = useUserProfileQuery(uploader.handle);
  const profileData = profileQuery.data;
  const followerCount = profileData?.counts.followers ?? null;
  const profileViewer = profileData?.viewer ?? null;
  const { setViewer, bumpFollowers } = useProfileCachePatchers(uploader.handle);

  const [followPending, setFollowPending] = React.useState(false);
  const isFollowing = profileViewer?.isFollowing ?? false;
  const canFollow =
    viewerId !== null &&
    profileViewer !== null &&
    !profileViewer.isSelf &&
    !profileViewer.isBlockedBy;

  const handleLikeToggle = React.useCallback(() => {
    if (!canLike) return;
    likeMutation.mutate(
      { clipId, nextLiked: !liked },
      {
        onError: (err) =>
          toast.error("Couldn't update like", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      },
    );
  }, [canLike, clipId, liked, likeMutation]);

  const handleDelete = React.useCallback(() => {
    if (!window.confirm("Delete this clip? This can't be undone.")) return;
    deleteMutation.mutate(
      { clipId },
      {
        onSuccess: () => {
          toast.success("Clip deleted");
          onDeleted?.();
        },
        onError: (err) =>
          toast.error("Couldn't delete clip", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      },
    );
  }, [clipId, deleteMutation, onDeleted]);

  const handleShare = React.useCallback(async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";

    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success("Clip link copied");
    } catch (err) {
      toast.error("Couldn't copy link", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  }, []);

  async function handleFollow() {
    if (followPending || !profileViewer) return;
    setFollowPending(true);
    const prev = profileViewer;
    const optimistic = { ...prev, isFollowing: !isFollowing };
    setViewer(optimistic);
    bumpFollowers(isFollowing ? -1 : 1);
    try {
      if (isFollowing) await unfollowUser(uploader.handle);
      else await followUser(uploader.handle);
    } catch (cause) {
      setViewer(prev);
      bumpFollowers(isFollowing ? 1 : -1);
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong",
      );
    } finally {
      setFollowPending(false);
    }
  }

  const avatarStyle = {
    background: uploader.avatar.bg ?? "var(--neutral-200)",
    color: uploader.avatar.fg ?? "var(--foreground)",
  } as const;

  return (
    <section className="flex flex-col gap-3">
      {/* Title + button cluster */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <EditableTitle clipId={clipId} value={title} canEdit={canEdit} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="default" aria-label="Views">
            <EyeIcon />
            <span className="tabular-nums">{views}</span>
          </Button>

          <Button
            variant={liked ? "accent-outline" : "ghost"}
            size="default"
            onClick={handleLikeToggle}
            disabled={!canLike || likeMutation.isPending}
            aria-pressed={liked}
            aria-label={canLike ? "Like clip" : "Sign in to like"}
            title={canLike ? undefined : "Sign in to like"}
          >
            <HeartIcon className={cn(liked && "fill-current")} />
            <span className="tabular-nums">{formatCount(likes)}</span>
          </Button>

          <Button variant="ghost" size="default" onClick={handleShare}>
            <Share2Icon />
            Share
          </Button>

          {canEdit ? (
            <PrivacyBadgeMenu clipId={clipId} value={privacy} asButton />
          ) : null}

          {canDelete ? (
            <Button
              variant="ghost"
              size="default"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete clip"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Author cluster */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            <Avatar size="xl" style={avatarStyle}>
              {uploader.avatar.src ? (
                <AvatarImage src={uploader.avatar.src} alt={uploader.name} />
              ) : null}
              <AvatarFallback style={avatarStyle}>
                {uploader.avatar.initials}
              </AvatarFallback>
            </Avatar>
          </Link>

          <div className="flex min-w-0 flex-col leading-tight">
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
            {followerCount !== null ? (
              <span className="mt-0.5 text-xs text-foreground-faint">
                <span className="text-foreground-muted">
                  {formatCount(followerCount)}
                </span>{" "}
                followers
              </span>
            ) : null}
          </div>

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

        <div className="ml-auto flex items-center gap-2">
          <EditableGame
            clipId={clipId}
            displayName={game}
            gameRef={gameRef}
            canEdit={canEdit}
          />
          <Badge variant="ghost">{postedAt}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ClipMentionsRow mentions={mentions} />
        {canEdit ? <EditableMentions clipId={clipId} value={mentions} /> : null}
      </div>

      <EditableDescription
        clipId={clipId}
        value={description}
        canEdit={canEdit}
      />
    </section>
  );
}

export { ClipMeta, type ClipMetaProps };
