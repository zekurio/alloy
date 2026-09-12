import type { ProfileCounts, ProfileViewer, PublicUser } from "@alloy/api"
import { tp } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { cn } from "@alloy/ui/lib/utils"

import { ProfileActions } from "@/components/profile/profile-actions"
import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { userAvatar, UserBanner } from "@/lib/user-display"

import { StatInline } from "./stat-inline"

type ProfileData = {
  user: PublicUser
  counts: ProfileCounts
}

type ProfileIdentityProps = {
  profile: ProfileData
  viewer: ProfileViewer | null | undefined
  onViewerChange: (viewer: ProfileViewer) => void
}

export function ProfileIdentity({
  profile,
  viewer,
  onViewerChange,
}: ProfileIdentityProps) {
  const { user, counts } = profile
  const handle = user.username
  const avatar = userAvatar(user)
  const actionNode =
    viewer?.isBlocked && !viewer.isSelf && !viewer.isBlockedBy ? (
      <ProfileActions
        targetHandle={handle}
        viewer={viewer}
        onChange={onViewerChange}
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
                alt={handle}
                fetchPriority="high"
                loading="eager"
              />
            ) : null}
            <AvatarFallback
              style={{ background: avatar.bg, color: avatar.fg }}
            />
          </Avatar>

          {/* Profile identity */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-lg font-semibold tracking-[-0.02em] sm:text-2xl">
                {handle}
              </h1>
              <StatInline
                value={counts.clips}
                label={tp(counts.clips, "post", "posts")}
              />
            </div>

            {actionNode ? <div className="shrink-0">{actionNode}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
