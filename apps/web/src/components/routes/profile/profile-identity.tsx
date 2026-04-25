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
  const hasDedicatedBanner = !!userImageSrc(user.banner)

  return (
    <>
      <div className="flex w-full flex-col">
        <section
          className={cn(
            "relative overflow-hidden rounded-lg",
            hasDedicatedBanner
              ? "aspect-[16/4] max-h-[280px] min-h-32 sm:min-h-[160px]"
              : "aspect-[5/2] max-h-[240px] min-h-32 sm:min-h-[140px]"
          )}
        >
          <UserBanner user={user} />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-2/3 rounded-[inherit] bg-gradient-to-t from-black/95 via-black/60 to-transparent"
          />

          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:gap-4 sm:p-6">
            <Avatar
              size="2xl"
              style={{ background: avatar.bg, color: avatar.fg }}
              className="size-16 shrink-0 text-xl shadow-[0_8px_24px_oklch(0_0_0_/_0.45)] sm:size-24 sm:text-[28px]"
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

            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
              <div className="flex min-w-0 items-center gap-3">
                <h1
                  className={cn(
                    "truncate text-2xl font-semibold tracking-[-0.02em] text-foreground",
                    "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] max-sm:text-xl sm:text-3xl"
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-none font-medium text-foreground-muted">
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

      <div className="mt-3 mb-3 sm:mb-4">
        <IdentityStats handle={handle} counts={counts} />
      </div>
    </>
  )
}
