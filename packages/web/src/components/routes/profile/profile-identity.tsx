import type { ProfileCounts, ProfileViewer, PublicUser } from "@alloy/api"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { cn } from "@alloy/ui/lib/utils"

import { ProfileActions } from "@/components/profile/profile-actions"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import {
  displayName,
  userAvatar,
  userHandle,
  UserBanner,
} from "@/lib/user-display"

import { IdentityStats } from "./identity-stats"

type ProfileData = {
  user: PublicUser
  counts: ProfileCounts
}

type ProfileIdentityProps = {
  profile: ProfileData
  viewer: ProfileViewer | null | undefined
  currentUserId: string | null
  onViewerChange: (viewer: ProfileViewer) => void
  onFollowerDelta: (delta: number) => void
}

export function ProfileIdentity({
  profile,
  viewer,
  currentUserId,
  onViewerChange,
  onFollowerDelta,
}: ProfileIdentityProps) {
  const { user, counts } = profile
  const handle = user.username
  const name = displayName(user)
  const avatar = userAvatar(user)
  const isSelf = viewer?.isSelf ?? currentUserId === user.id
  const showProfileAction =
    !isSelf &&
    (viewer === undefined || !viewer || (!viewer.isSelf && !viewer.isBlockedBy))

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
    <div className="flex w-full flex-col">
      {/* Full-width banner */}
      <section
        className={cn(
          "relative w-full overflow-hidden",
          APP_BANNER_HEIGHT_CLASS,
        )}
      >
        <UserBanner user={user} />
      </section>

      {/* Profile info bar */}
      <div className="px-4 pb-3 sm:pb-4 md:px-6">
        <div className="flex items-end gap-3 sm:gap-4">
          {/* Avatar — overlaps the banner above */}
          <Avatar
            size="2xl"
            style={{ background: avatar.bg, color: avatar.fg }}
            className={cn(
              "ring-background !size-16 shrink-0 ring-[3px]",
              "sm:!size-24 sm:ring-4",
              "-mt-8 sm:-mt-12",
            )}
          >
            {avatar.src ? (
              <AvatarImage
                src={avatar.src}
                alt={name}
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
              {/* Name row */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                <h1 className="text-foreground truncate text-lg font-semibold tracking-[-0.02em] sm:text-2xl">
                  {name}
                </h1>
              </div>
              <div className="text-foreground-faint truncate text-sm">
                {userHandle(user)}
              </div>

              {/* Stats */}
              <div className="mt-1">
                <IdentityStats handle={handle} counts={counts} />
              </div>
            </div>

            {/* Follow / action button */}
            {actionNode ? <div className="shrink-0">{actionNode}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
