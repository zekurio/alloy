import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  BookmarkIcon,
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  Share2Icon,
} from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

import { formatCount } from "../lib/clip-format";

/**
 * Uploader details + action bar that sits under the clip player.
 *
 * Cribs the YouTube watch-page layout: the title hangs by itself at the
 * top, and underneath we pack uploader identity on the left and engagement
 * actions on the right. The game badge + views + posted time collapse
 * into the uploader subtitle so the whole block reads as a single
 * "who posted this, and what's its status" band instead of three
 * stacked strips of metadata.
 */
interface ClipMetaProps {
  title: string;
  game: string;
  views: string;
  postedAt: string;
  uploader: {
    /**
     * Username handle — renders the avatar/name/profile-link as real
     * `<Link>`s into `/u/:handle`. Required for real clip rows; the
     * server guarantees every clip row has an author with a username.
     */
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
}

function ClipMeta({
  title,
  game,
  views,
  postedAt,
  uploader,
  likes,
  comments,
}: ClipMetaProps) {
  const [liked, setLiked] = React.useState(false);
  const [bookmarked, setBookmarked] = React.useState(false);

  const likeCount = likes + (liked ? 1 : 0);

  const avatarStyle = {
    background: uploader.avatar.bg ?? "var(--neutral-200)",
    color: uploader.avatar.fg ?? "var(--foreground)",
  } as const;

  return (
    <section className="flex flex-col gap-3">
      {/* ── Title ───────────────────────────────────────────── */}
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h1>

      {/* ── YouTube-style row: uploader on left, actions on right ─ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Uploader identity + profile link */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/u/$username"
            params={{ username: uploader.handle }}
            aria-label={`Open ${uploader.name}'s profile`}
            className={cn(
              "shrink-0 rounded-md",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
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
                "inline-flex items-center gap-1.5 text-md font-semibold tracking-[-0.005em] text-foreground",
                "hover:text-accent",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "focus-visible:text-accent focus-visible:outline-none",
              )}
            >
              <span className="truncate">@{uploader.name}</span>
            </Link>
            <span className="mt-1 flex flex-wrap items-center gap-2 font-mono text-2xs tracking-[0.06em] text-foreground-faint uppercase">
              <Badge variant="accent">{game}</Badge>
              <span>
                <span className="text-foreground-muted normal-case">
                  {views}
                </span>{" "}
                views
              </span>
              <span aria-hidden>·</span>
              <span>{postedAt}</span>
            </span>
          </div>
        </div>

        {/* Engagement actions — plain Alloy secondary pills (rounded-md,
            surface-raised, 36px tall). Sized up to `lg` so the bar has
            visual weight under a widescreen player, but otherwise
            indistinguishable from buttons elsewhere in the app. */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={liked ? "accent-outline" : "secondary"}
            size="lg"
            onClick={() => setLiked((l) => !l)}
            aria-pressed={liked}
            aria-label="Like clip"
          >
            <HeartIcon className={cn(liked && "fill-current")} />
            <span className="font-mono tracking-[0.04em]">
              {formatCount(likeCount)}
            </span>
          </Button>

          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              const el = document.querySelector<HTMLTextAreaElement>(
                "[data-slot='comment-input']",
              );
              el?.focus();
            }}
            aria-label="Jump to comments"
          >
            <MessageSquareIcon />
            <span className="font-mono tracking-[0.04em]">
              {formatCount(comments)}
            </span>
          </Button>

          <Button variant="secondary" size="lg">
            <Share2Icon />
            Share
          </Button>

          <Button
            variant={bookmarked ? "accent-outline" : "secondary"}
            size="lg"
            onClick={() => setBookmarked((b) => !b)}
            aria-label="Save clip"
            aria-pressed={bookmarked}
          >
            <BookmarkIcon className={cn(bookmarked && "fill-current")} />
            {bookmarked ? "Saved" : "Save"}
          </Button>

          <Button variant="secondary" size="icon-lg" aria-label="More options">
            <MoreHorizontalIcon />
          </Button>
        </div>
      </div>
    </section>
  );
}

export { ClipMeta, type ClipMetaProps };
