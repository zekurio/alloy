import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

import { ProfileActions } from "@/components/profile/profile-actions"
import { UserBanner, userAvatar } from "@/lib/user-display"
import type { ProfileCounts, ProfileViewer, PublicUser } from "@workspace/api"
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
}

export function ProfileIdentity({
  profile,
  viewer,
  onViewerChange,
  onFollowerDelta,
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
    <div className="flex w-full flex-col">
      {/* Banner */}
      <section
        className={cn(
          "relative h-[120px] w-full overflow-hidden sm:h-[clamp(200px,22vw,360px)]"
        )}
      >
        <UserBanner user={user} />
      </section>

      {/* Profile info bar */}
      <div className="px-4 pb-3 sm:pb-4 md:px-8">
        <div className="flex items-start gap-3 sm:gap-4">
          {/* Avatar — overlaps the banner */}
          <Avatar
            size="2xl"
            style={{ background: avatar.bg, color: avatar.fg }}
            className={cn(
              "!size-16 shrink-0 !text-lg ring-[3px] ring-background",
              "sm:!size-24 sm:!text-[28px] sm:ring-4",
              "-mt-8 sm:-mt-12"
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
            <AvatarFallback
              style={{ background: avatar.bg, color: avatar.fg }}
            >
              {avatar.initials}
            </AvatarFallback>
          </Avatar>

          {/* Identity + action */}
          <div className="flex min-w-0 flex-1 items-start gap-3 pt-2 sm:pt-2.5">
            <div className="min-w-0 flex-1">
              {/* Name row with inline handle */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
                  {user.name || `@${handle}`}
                </h1>
                {user.name ? (
                  <span className="truncate text-sm font-medium text-foreground-muted">
                    @{handle}
                  </span>
                ) : null}
              </div>

              {/* Stats */}
              <div className="mt-0.5">
                <IdentityStats handle={handle} counts={counts} />
              </div>
            </div>

            {/* Follow / action button */}
            {actionNode ? (
              <div className="shrink-0">{actionNode}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
