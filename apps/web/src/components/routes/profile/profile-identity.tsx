import { CalendarIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"

import { ProfileActions } from "../../../components/profile-actions"
import { avatarTint, displayInitials } from "../../../lib/user-display"
import type {
  ProfileCounts,
  ProfileViewer,
  PublicUser,
} from "../../../lib/users-api"
import { IdentityStats } from "./identity-stats"
import { useBannerGradient } from "./profile-banner-gradient"

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
  const initials = displayInitials(handle)
  const { bg, fg } = avatarTint(user.id)
  const joined = formatJoined(user.createdAt)
  const bannerStyle = useBannerGradient(user.image, handle, user.id)

  return (
    <section className="mb-8">
      <div
        aria-hidden
        className="h-32 w-full rounded-lg sm:h-40"
        style={bannerStyle}
      />

      <div className="-mt-10 flex flex-col gap-5 px-1 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="flex items-end gap-5">
          <Avatar
            size="2xl"
            ring
            style={{ background: bg, color: fg }}
            className="shadow-[0_8px_24px_oklch(0_0_0_/_0.45)]"
          >
            {user.image ? <AvatarImage src={user.image} alt={handle} /> : null}
            <AvatarFallback style={{ background: bg, color: fg }}>
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col gap-1.5 pb-1">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">
              @{handle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs leading-none text-foreground-faint">
              <span className="inline-flex items-center gap-1.5 leading-none">
                <CalendarIcon className="size-3 shrink-0" aria-hidden />
                <span>joined {joined}</span>
              </span>
            </div>
            <IdentityStats counts={counts} />
          </div>
        </div>

        <div className="flex shrink-0 items-center sm:pb-1">
          <ProfileActions
            targetHandle={handle}
            viewer={viewer}
            onChange={(next) => {
              const wasFollowing = viewer?.isFollowing ?? false
              const willFollow = next.isFollowing
              if (wasFollowing !== willFollow) {
                onFollowerDelta(willFollow ? 1 : -1)
              }
              if (!viewer?.isBlocked && next.isBlocked && wasFollowing) {
                onFollowerDelta(-1)
              }
              onViewerChange(next)
            }}
          />
        </div>
      </div>
    </section>
  )
}

function formatJoined(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  })
}
