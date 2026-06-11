import type { ProfileCounts, ProfileViewer, PublicUser } from "@alloy/api"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { cn } from "@alloy/ui/lib/utils"

import { ProfileActions } from "@/components/profile/profile-actions"
import { userAvatar } from "@/lib/user-display"

import { IdentityStats } from "./identity-stats"

type ProfileData = {
  user: PublicUser
  counts: ProfileCounts
}

type ProfileIdentityProps = {
  profile: ProfileData
  viewer: ProfileViewer | null | undefined
  onViewerChange: (viewer: ProfileViewer) => void
  onFollowerDelta: (delta: number) => void
  /**
   * When true a banner sits above this bar and the avatar straddles the seam.
   * When false (no banner) the bar is the rounded top of the card, so the
   * avatar sits inline with normal top spacing instead of overlapping upward.
   */
  hasBanner: boolean
}

export function ProfileIdentity({
  profile,
  viewer,
  onViewerChange,
  onFollowerDelta,
  hasBanner,
}: ProfileIdentityProps) {
  const { user, counts } = profile
  const handle = user.username
  const avatar = userAvatar(user)
  const showProfileAction =
    viewer === undefined || !viewer || (!viewer.isSelf && !viewer.isBlockedBy)

  const actionNode = showProfileAction ? (
    <ProfileActions
      targetHandle={handle}
      viewer={viewer}
      onChange={(next) => {
        const wasFollowing = viewer?.isFollowing ?? false
        const willFollow = next.isFollowing
        if (wasFollowing !== willFollow) {
          onFollowerDelta(willFollow ? 1 : -1)
        }
        onViewerChange(next)
      }}
    />
  ) : null

  return (
    // Identity bar — lives inside the frosted card body. With a banner it
    // straddles the seam; without one it is the rounded top of the card.
    <div className={cn(hasBanner ? "pb-4" : "pt-4 pb-4 sm:pt-5")}>
      <div
        className={cn(
          "flex gap-3 sm:gap-4",
          hasBanner ? "items-end" : "items-center",
        )}
      >
        {/* Avatar — straddles the banner above when there is one */}
        <Avatar
          size="2xl"
          style={{ background: avatar.bg, color: avatar.fg }}
          className={cn(
            "!size-16 shrink-0 !text-lg ring-2 ring-white/10",
            "sm:!size-24 sm:!text-[28px]",
            hasBanner && "-mt-10 sm:-mt-14",
          )}
        >
          {avatar.src ? (
            <AvatarImage
              src={avatar.src}
              alt={handle}
              fetchPriority="high"
              loading="eager"
            />
          ) : null}
          <AvatarFallback style={{ background: avatar.bg, color: avatar.fg }}>
            {avatar.initials}
          </AvatarFallback>
        </Avatar>

        {/* Identity + action */}
        <div className="flex min-w-0 flex-1 items-end gap-3">
          <div className="min-w-0 flex-1">
            {/* Name row with inline handle */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
              <h1 className="text-foreground truncate text-lg font-semibold tracking-[-0.02em] sm:text-2xl">
                @{handle}
              </h1>
            </div>

            {/* Stats */}
            <div className="mt-0.5">
              <IdentityStats handle={handle} counts={counts} />
            </div>
          </div>

          {/* Follow / action button */}
          {actionNode ? <div className="shrink-0">{actionNode}</div> : null}
        </div>
      </div>
    </div>
  )
}
