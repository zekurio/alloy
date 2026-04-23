import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

import { ProfileActions } from "@/components/profile/profile-actions"
import { UserBanner, userAvatar, userImageSrc } from "@/lib/user-display"
import type { ProfileCounts, ProfileViewer, PublicUser } from "@workspace/api"
import { IdentityStats } from "./identity-stats"

type ProfileData = {
  user: PublicUser
  counts: ProfileCounts
  viewer: ProfileViewer | null
}

type ProfileIdentityProps = {
  profile: ProfileData
  onViewerChange: (viewer: ProfileViewer) => void
  onFollowerDelta: (delta: number) => void
}

export function ProfileIdentity({
  profile,
  onViewerChange,
  onFollowerDelta,
}: ProfileIdentityProps) {
  const { user, counts, viewer } = profile
  const handle = user.username
  const avatar = userAvatar(user)
  const hasDedicatedBanner = !!userImageSrc(user.banner)

  return (
    <>
      <div className="flex w-full flex-col">
        <section
          className={cn(
            "relative -mx-4 -mt-6 overflow-hidden md:-mx-8",
            hasDedicatedBanner
              ? "aspect-[16/4] max-h-[280px] min-h-[160px]"
              : "aspect-[3/1] max-h-[240px] min-h-[140px]"
          )}
        >
          <UserBanner user={user} />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
          />

          <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4 sm:p-6">
            <Avatar
              size="2xl"
              style={{ background: avatar.bg, color: avatar.fg }}
              className="shrink-0 shadow-[0_8px_24px_oklch(0_0_0_/_0.45)]"
            >
              {avatar.src ? (
                <AvatarImage src={avatar.src} alt={handle} />
              ) : null}
              <AvatarFallback
                style={{ background: avatar.bg, color: avatar.fg }}
              >
                {avatar.initials}
              </AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
              <div className="flex min-w-0 items-center gap-3">
                <h1
                  className={cn(
                    "truncate text-2xl font-semibold tracking-[-0.02em] text-foreground",
                    "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:text-3xl"
                  )}
                >
                  {user.name || `@${handle}`}
                </h1>
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
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-none font-medium text-foreground-muted">
                {user.name ? (
                  <span className="truncate leading-none font-semibold">
                    @{handle}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-3 mb-4">
        <IdentityStats handle={handle} counts={counts} />
      </div>
    </>
  )
}
